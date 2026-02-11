const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';

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
        const { code } = JSON.parse(event.body);
        const upperCode = code?.toUpperCase()?.trim();

        if (!upperCode) {
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Please enter a promo code' }) };
        }

        // Fetch all DISCOUNT, PRICING_RULE, and DISCOUNT_CODE objects in one call
        const searchResponse = await fetch(`${SQUARE_BASE_URL}/catalog/search`, {
            method: 'POST',
            headers: {
                'Square-Version': '2024-11-20',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                object_types: ['DISCOUNT', 'PRICING_RULE', 'PRODUCT_SET'],
                include_related_objects: true
            })
        });

        if (!searchResponse.ok) {
            const errText = await searchResponse.text();
            console.error('Catalog search failed:', searchResponse.status, errText);
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Unable to validate promo code. Please try again.' }) };
        }

        const searchData = await searchResponse.json();
        const allObjects = searchData.objects || [];
        const relatedObjects = searchData.related_objects || [];
        const allCombined = [...allObjects, ...relatedObjects];

        const discounts = allCombined.filter(o => o.type === 'DISCOUNT');
        const pricingRules = allCombined.filter(o => o.type === 'PRICING_RULE');

        console.log('All discounts:', discounts.map(d => ({
            id: d.id, name: d.discount_data?.name, type: d.discount_data?.discount_type
        })));
        console.log('All pricing rules:', pricingRules.map(r => ({
            id: r.id, name: r.pricing_rule_data?.name, discountId: r.pricing_rule_data?.discount_id
        })));

        // Strategy 1: Match by discount name
        let matchedDiscount = discounts.find(d =>
            d.discount_data?.name?.toUpperCase()?.trim() === upperCode
        );

        // Strategy 2: Match by pricing rule name (Square coupons store the code here)
        let matchedRule = null;
        if (!matchedDiscount) {
            matchedRule = pricingRules.find(r =>
                r.pricing_rule_data?.name?.toUpperCase()?.trim() === upperCode
            );

            if (matchedRule) {
                const discountId = matchedRule.pricing_rule_data?.discount_id;
                if (discountId) {
                    matchedDiscount = allCombined.find(o => o.id === discountId && o.type === 'DISCOUNT');
                    if (!matchedDiscount) {
                        // Fetch the discount directly
                        const dRes = await fetch(`${SQUARE_BASE_URL}/catalog/object/${discountId}`, {
                            headers: {
                                'Square-Version': '2024-11-20',
                                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        if (dRes.ok) {
                            const dData = await dRes.json();
                            matchedDiscount = dData.object;
                        }
                    }
                }
            }
        }

        // Strategy 3: Partial/contains match on both discounts and pricing rules
        if (!matchedDiscount && !matchedRule) {
            matchedDiscount = discounts.find(d =>
                d.discount_data?.name?.toUpperCase()?.trim()?.includes(upperCode) ||
                upperCode.includes(d.discount_data?.name?.toUpperCase()?.trim() || '')
            );

            if (!matchedDiscount) {
                matchedRule = pricingRules.find(r =>
                    r.pricing_rule_data?.name?.toUpperCase()?.trim()?.includes(upperCode) ||
                    upperCode.includes(r.pricing_rule_data?.name?.toUpperCase()?.trim() || '')
                );

                if (matchedRule) {
                    const discountId = matchedRule.pricing_rule_data?.discount_id;
                    if (discountId) {
                        matchedDiscount = allCombined.find(o => o.id === discountId && o.type === 'DISCOUNT');
                        if (!matchedDiscount) {
                            const dRes = await fetch(`${SQUARE_BASE_URL}/catalog/object/${discountId}`, {
                                headers: {
                                    'Square-Version': '2024-11-20',
                                    'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            if (dRes.ok) {
                                const dData = await dRes.json();
                                matchedDiscount = dData.object;
                            }
                        }
                    }
                }
            }
        }

        if (!matchedDiscount) {
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Invalid promo code' }) };
        }

        const discount = matchedDiscount.discount_data;

        // Find linked pricing rule for date validation
        if (!matchedRule) {
            matchedRule = pricingRules.find(r =>
                r.pricing_rule_data?.discount_id === matchedDiscount.id
            );
        }

        const pricingRuleData = matchedRule?.pricing_rule_data || null;

        // Check validity dates
        if (pricingRuleData) {
            const today = new Date().toISOString().split('T')[0];
            const validFrom = pricingRuleData.valid_from_date;
            const validUntil = pricingRuleData.valid_until_date;

            if (validFrom && today < validFrom) {
                return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'This promo code is not yet active' }) };
            }
            if (validUntil && today > validUntil) {
                return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'This promo code has expired' }) };
            }
        }

        return { statusCode: 200, headers, body: JSON.stringify(buildDiscountResponse(upperCode, discount, pricingRuleData)) };
    } catch (err) {
        console.error('Validate promo error:', err);
        return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Unable to validate promo code. Please try again.' }) };
    }
};

function buildDiscountResponse(code, discount, pricingRuleData) {
    const result = { valid: true, code: code, freeShipping: false };
    const discountName = (discount.name || '').toLowerCase();

    if (discountName.includes('free shipping') || code === 'FREESHIP') {
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

    return result;
}
