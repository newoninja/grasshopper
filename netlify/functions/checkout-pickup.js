const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'dyette@icloud.com';
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';
const { sendEmail } = require('./gmail-utils');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': SITE_ORIGIN,
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
        const { items, phone } = JSON.parse(event.body);

        // Format phone number to E.164 format (Square requirement)
        // Remove all non-numeric characters
        const cleanPhone = phone.replace(/\D/g, '');
        // Add +1 for US if not already present
        const formattedPhone = cleanPhone.startsWith('1') ? `+${cleanPhone}` : `+1${cleanPhone}`;

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

        // Create checkout with NO shipping (local pickup)
        const checkoutResponse = await fetch(`${SQUARE_BASE_URL}/online-checkout/payment-links`, {
            method: 'POST',
            headers: {
                'Square-Version': '2024-01-18',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                idempotency_key: `pickup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                order: {
                    location_id: locationId,
                    line_items: lineItems
                },
                checkout_options: {
                    allow_tipping: false,
                    ask_for_shipping_address: false,
                    accepted_payment_methods: {
                        apple_pay: true,
                        google_pay: true,
                        cash_app_pay: false,
                        afterpay_clearpay: false
                    }
                },
                pre_populated_data: {
                    buyer_phone_number: formattedPhone
                }
            })
        });

        const checkoutData = await checkoutResponse.json();

        console.log('Square checkout response status:', checkoutResponse.status);
        console.log('Square checkout response:', JSON.stringify(checkoutData, null, 2));

        if (checkoutData.payment_link) {
            // Send email notification
            try {
                const itemsList = items.map(item =>
                    `- ${item.name} (Qty: ${item.quantity}) - $${item.price.toFixed(2)}`
                ).join('\n');

                const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

                await sendEmail({
                    to: OWNER_EMAIL,
                    subject: 'New Local Pickup Order',
                    textBody: `New Local Pickup Order

Customer Phone: ${phone}

Items:
${itemsList}

Subtotal: $${total.toFixed(2)}
Shipping: $0.00 (Local Pickup)
Total: $${total.toFixed(2)}

---
The customer will complete payment at the checkout link.
Please contact them at ${phone} within 24 hours to arrange pickup.

Order Link: ${checkoutData.payment_link.url}
`
                });
            } catch (emailError) {
                console.error('Email error:', emailError);
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    checkoutUrl: checkoutData.payment_link.url,
                    message: 'Pickup order created'
                })
            };
        } else {
            console.error('Checkout error:', checkoutData);
            const errorMessage = checkoutData.errors?.[0]?.detail || checkoutData.errors?.[0]?.code || 'Failed to create checkout';
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: errorMessage,
                    details: checkoutData.errors || checkoutData
                })
            };
        }
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create pickup checkout' }) };
    }
};
