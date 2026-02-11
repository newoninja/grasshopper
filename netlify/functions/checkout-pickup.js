const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'dyette@icloud.com';
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';
const { sendEmail } = require('./gmail-utils');
const { fetchSquareJson, getLocationId } = require('./square-utils');
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
        const { items, phone } = parsed.body;
        if (!Array.isArray(items) || items.length === 0) {
            return jsonResponse(400, headers, { error: 'No items provided' });
        }
        if (!phone || String(phone).replace(/\D/g, '').length < 10) {
            return jsonResponse(400, headers, { error: 'Valid phone number required' });
        }
        if (!SQUARE_ACCESS_TOKEN) {
            return jsonResponse(500, headers, { error: 'Checkout service not configured' });
        }
        console.log('Legacy endpoint used: checkout-pickup.js');

        // Format phone number to E.164 format (Square requirement)
        // Remove all non-numeric characters
        const cleanPhone = phone.replace(/\D/g, '');
        // Add +1 for US if not already present
        const formattedPhone = cleanPhone.startsWith('1') ? `+${cleanPhone}` : `+1${cleanPhone}`;

        const locationId = await getLocationId(SQUARE_ACCESS_TOKEN);

        const lineItems = items.map(item => ({
            quantity: item.quantity.toString(),
            catalog_object_id: item.variationId,
            item_type: 'ITEM'
        }));

        // Create checkout with NO shipping (local pickup)
        const checkoutResponse = await fetchSquareJson(SQUARE_ACCESS_TOKEN, '/online-checkout/payment-links', {
            method: 'POST',
            body: {
                idempotency_key: `pickup-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
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
            }
        });

        const checkoutData = checkoutResponse.data;

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
            return jsonResponse(400, headers, {
                error: errorMessage,
                details: checkoutData.errors || checkoutData
            });
        }
    } catch (error) {
        console.error('Error:', error);
        return jsonResponse(500, headers, { error: 'Failed to create pickup checkout' });
    }
};
