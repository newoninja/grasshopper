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
        const { code } = JSON.parse(event.body);
        const upperCode = code?.toUpperCase()?.trim();

        if (!upperCode) {
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Please enter a promo code' }) };
        }

        // Search Square catalog for pricing rules (coupons) with related discount objects
        const searchResponse = await fetch(`${SQUARE_BASE_URL}/catalog/search`, {
            method: 'POST',
            headers: {
                'Square-Version': '2024-11-20',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                object_types: ['PRICING_RULE'],
                include_related_objects: true
            })
        });

        if (!searchResponse.ok) {
            const errText = await searchResponse.text();
            console.error('Catalog search failed:', searchResponse.status, errText);
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Unable to validate promo code. Please try again.' }) };
        }

        const searchData = await searchResponse.json();
        const pricingRules = searchData.objects || [];
        const relatedObjects = searchData.related_objects || [];

        // Find pricing rule matching the entered code by name
        const matchingRule = pricingRules.find(rule =>
            rule.pricing_rule_data?.name?.toUpperCase() === upperCode
        );

        if (!matchingRule) {
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Invalid promo code' }) };
        }

        // Check validity dates
        const today = new Date().toISOString().split('T')[0];
        const validFrom = matchingRule.pricing_rule_data?.valid_from_date;
        const validUntil = matchingRule.pricing_rule_data?.valid_until_date;

        if (validFrom && today < validFrom) {
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'This promo code is not yet active' }) };
        }
        if (validUntil && today > validUntil) {
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'This promo code has expired' }) };
        }

        // Find the associated discount in related objects
        const discountId = matchingRule.pricing_rule_data?.discount_id;
        let discount = null;

        if (discountId) {
            const discountObj = relatedObjects.find(obj => obj.id === discountId && obj.type === 'DISCOUNT');
            if (discountObj) {
                discount = discountObj.discount_data;
            } else {
                // Fetch discount separately if not in related objects
                const discountResponse = await fetch(`${SQUARE_BASE_URL}/catalog/object/${discountId}`, {
                    headers: {
                        'Square-Version': '2024-11-20',
                        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                });
                if (discountResponse.ok) {
                    const discountData = await discountResponse.json();
                    discount = discountData.object?.discount_data;
                }
            }
        }

        if (!discount) {
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Invalid promo code' }) };
        }

        // Build response based on discount type
        const result = { valid: true, code: upperCode, freeShipping: false };
        const discountName = (discount.name || '').toLowerCase();

        if (discountName.includes('free shipping') || upperCode === 'FREESHIP') {
            result.type = 'fixed';
            result.value = 0;
            result.freeShipping = true;
            result.message = 'Free shipping applied!';
        } else if (discount.discount_type === 'FIXED_PERCENTAGE' || discount.discount_type === 'VARIABLE_PERCENTAGE') {
            const pct = parseFloat(discount.percentage || '0');
            result.type = 'percent';
            result.value = pct;
            result.message = `${pct}% off your order!`;
        } else if (discount.discount_type === 'FIXED_AMOUNT' || discount.discount_type === 'VARIABLE_AMOUNT') {
            const cents = discount.amount_money?.amount || 0;
            result.type = 'fixed';
            result.value = cents;
            result.message = `$${(cents / 100).toFixed(2)} off your order!`;
        } else {
            result.type = 'percent';
            result.value = 0;
            result.message = 'Discount applied!';
        }

        return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (err) {
        console.error('Validate promo error:', err);
        return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Unable to validate promo code. Please try again.' }) };
    }
};
