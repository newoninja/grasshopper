const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';
const { getShippingCost, getProductWeight, getUpsShippingCost } = require('./shipping-data');

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
        const { items, destinationState } = JSON.parse(event.body);

        if (!items || !items.length) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'No items provided' }) };
        }

        let totalWeight = 0;

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
                            totalWeight += getProductWeight(productName, variationName) * (item.quantity || 1);
                        } else {
                            totalWeight += 1.5 * (item.quantity || 1); // fallback weight
                        }
                    } else {
                        totalWeight += 1.5 * (item.quantity || 1);
                    }
                } else {
                    totalWeight += 1.5 * (item.quantity || 1);
                }
            } catch (err) {
                console.error('Error fetching product for shipping:', err);
                totalWeight += 1.5 * (item.quantity || 1);
            }
        }

        // If destination state provided, use UPS zone-based pricing
        if (destinationState) {
            const shippingAmount = getUpsShippingCost(totalWeight, destinationState.toUpperCase());
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ shippingAmount, totalWeight: Math.round(totalWeight * 10) / 10 })
            };
        }

        // Fallback: estimate for zone 5 (mid-range)
        const shippingAmount = getUpsShippingCost(totalWeight, 'NY');
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ shippingAmount, totalWeight: Math.round(totalWeight * 10) / 10 })
        };
    } catch (error) {
        console.error('Calculate shipping error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to calculate shipping' }) };
    }
};
