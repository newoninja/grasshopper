const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

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
        const { items, phone } = JSON.parse(event.body);

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
                    ask_for_shipping_address: false
                },
                pre_populated_data: {
                    buyer_phone_number: phone
                }
            })
        });

        const checkoutData = await checkoutResponse.json();

        if (checkoutData.payment_link) {
            // Send email notification
            try {
                const itemsList = items.map(item =>
                    `- ${item.name} (Qty: ${item.quantity}) - $${item.price.toFixed(2)}`
                ).join('\n');

                const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

                const emailBody = {
                    personalizations: [{
                        to: [{ email: 'dyette@icloud.com' }],
                        subject: '🛍️ New Local Pickup Order'
                    }],
                    from: {
                        email: 'orders@shopgrasshopper.com',
                        name: 'The Grasshopper'
                    },
                    content: [{
                        type: 'text/plain',
                        value: `New Local Pickup Order

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
                    }]
                };

                if (SENDGRID_API_KEY) {
                    await fetch('https://api.sendgrid.com/v3/mail/send', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${SENDGRID_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(emailBody)
                    });
                } else {
                    console.log('SendGrid not configured, email not sent:', emailBody);
                }
            } catch (emailError) {
                console.error('Email error:', emailError);
                // Don't fail the checkout if email fails
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
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Failed to create checkout' }) };
        }
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create pickup checkout' }) };
    }
};
