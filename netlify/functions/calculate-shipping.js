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

        if (!items || !items.length) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'No items provided' }) };
        }

        let totalShipping = 0;

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
                            const shippingPerUnit = getShippingCost(productName, variationName);
                            totalShipping += shippingPerUnit * (item.quantity || 1);
                        } else {
                            totalShipping += 750 * (item.quantity || 1);
                        }
                    } else {
                        totalShipping += 750 * (item.quantity || 1);
                    }
                } else {
                    totalShipping += 750 * (item.quantity || 1);
                }
            } catch (err) {
                console.error('Error fetching product for shipping:', err);
                totalShipping += 750 * (item.quantity || 1);
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ shippingAmount: totalShipping })
        };
    } catch (error) {
        console.error('Calculate shipping error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to calculate shipping' }) };
    }
};
