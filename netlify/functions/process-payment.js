const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
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
        const { sourceId, items, orderType, phone, totalAmount } = JSON.parse(event.body);

        if (!sourceId || !items || !items.length || !orderType) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
        }

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

        // Build line items
        const lineItems = items.map(item => ({
            quantity: (item.quantity || 1).toString(),
            catalog_object_id: item.variationId,
            item_type: 'ITEM'
        }));

        // Calculate shipping for non-pickup orders
        let shippingAmount = 0;
        if (orderType !== 'pickup') {
            for (const item of items) {
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
                                shippingAmount += getShippingCost(productName, variationName) * (item.quantity || 1);
                            } else {
                                shippingAmount += 750 * (item.quantity || 1);
                            }
                        } else {
                            shippingAmount += 750 * (item.quantity || 1);
                        }
                    } else {
                        shippingAmount += 750 * (item.quantity || 1);
                    }
                } catch (err) {
                    console.error('Error fetching product for shipping:', err);
                    shippingAmount += 750 * (item.quantity || 1);
                }
            }
        }

        // Build order body
        const orderBody = {
            location_id: locationId,
            line_items: lineItems
        };

        if (shippingAmount > 0) {
            orderBody.service_charges = [{
                name: 'Shipping',
                amount_money: { amount: shippingAmount, currency: 'USD' },
                calculation_phase: 'SUBTOTAL_PHASE'
            }];
        }

        // Create the order
        const idempotencyBase = `${orderType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const orderResponse = await fetch(`${SQUARE_BASE_URL}/orders`, {
            method: 'POST',
            headers: {
                'Square-Version': '2024-01-18',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                idempotency_key: `order-${idempotencyBase}`,
                order: orderBody
            })
        });

        const orderData = await orderResponse.json();

        if (!orderData.order) {
            console.error('Order creation error:', orderData);
            const errorMsg = orderData.errors?.[0]?.detail || 'Failed to create order';
            return { statusCode: 400, headers, body: JSON.stringify({ error: errorMsg }) };
        }

        const orderId = orderData.order.id;
        const orderTotal = orderData.order.total_money.amount;

        // Process payment
        const paymentBody = {
            idempotency_key: `pay-${idempotencyBase}`,
            source_id: sourceId,
            amount_money: {
                amount: orderTotal,
                currency: 'USD'
            },
            order_id: orderId,
            location_id: locationId
        };

        const paymentResponse = await fetch(`${SQUARE_BASE_URL}/payments`, {
            method: 'POST',
            headers: {
                'Square-Version': '2024-01-18',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paymentBody)
        });

        const paymentData = await paymentResponse.json();

        if (!paymentData.payment || paymentData.payment.status === 'FAILED') {
            console.error('Payment error:', paymentData);
            const errorMsg = paymentData.errors?.[0]?.detail || 'Payment failed';
            return { statusCode: 400, headers, body: JSON.stringify({ error: errorMsg }) };
        }

        // For pickup orders, send email notification
        if (orderType === 'pickup' && phone) {
            try {
                const itemsList = items.map(item =>
                    `- ${item.name} (Qty: ${item.quantity || 1}) - $${(item.price || 0).toFixed(2)}`
                ).join('\n');

                const total = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);

                const emailBody = {
                    personalizations: [{
                        to: [{ email: 'dyette@icloud.com' }],
                        subject: 'New Local Pickup Order — Payment Completed'
                    }],
                    from: {
                        email: 'orders@shopgrasshopper.com',
                        name: 'The Grasshopper'
                    },
                    content: [{
                        type: 'text/plain',
                        value: `New Local Pickup Order — PAID

Customer Phone: ${phone}

Items:
${itemsList}

Subtotal: $${total.toFixed(2)}
Shipping: $0.00 (Local Pickup)
Total: $${total.toFixed(2)}

Payment ID: ${paymentData.payment.id}
Order ID: ${orderId}

---
Payment has been completed. Please contact the customer at ${phone} within 24 hours to arrange pickup.
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
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                paymentId: paymentData.payment.id,
                orderId: orderId,
                receiptUrl: paymentData.payment.receipt_url || null
            })
        };
    } catch (error) {
        console.error('Process payment error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Payment processing failed' }) };
    }
};
