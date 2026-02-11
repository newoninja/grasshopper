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

        // Search Square catalog for DISCOUNT objects (coupons created in Square Dashboard)
        const searchResponse = await fetch(`${SQUARE_BASE_URL}/catalog/search`, {
            method: 'POST',
            headers: {
                'Square-Version': '2024-11-20',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                object_types: ['DISCOUNT'],
                include_related_objects: true
            })
        });

        if (!searchResponse.ok) {
            const errText = await searchResponse.text();
            console.error('Catalog search failed:', searchResponse.status, errText);
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Unable to validate promo code. Please try again.' }) };
        }

        const searchData = await searchResponse.json();
        const discounts = searchData.objects || [];

        console.log('Found discounts:', discounts.map(d => ({
            id: d.id,
            name: d.discount_data?.name,
            type: d.discount_data?.discount_type
        })));

        // Match discount by name (case-insensitive) - Square Dashboard stores the coupon code as the discount name
        const matchingDiscount = discounts.find(obj =>
            obj.discount_data?.name?.toUpperCase()?.trim() === upperCode
        );

        if (!matchingDiscount) {
            // Also try searching PRICING_RULE objects as fallback
            const prSearchResponse = await fetch(`${SQUARE_BASE_URL}/catalog/search`, {
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

            if (prSearchResponse.ok) {
                const prData = await prSearchResponse.json();
                const pricingRules = prData.objects || [];
                const relatedObjects = prData.related_objects || [];

                console.log('Found pricing rules:', pricingRules.map(r => ({
                    id: r.id,
                    name: r.pricing_rule_data?.name
                })));

                const matchingRule = pricingRules.find(rule =>
                    rule.pricing_rule_data?.name?.toUpperCase()?.trim() === upperCode
                );

                if (matchingRule) {
                    // Found via pricing rule - get the associated discount
                    const discountId = matchingRule.pricing_rule_data?.discount_id;
                    let discount = null;

                    if (discountId) {
                        const discountObj = relatedObjects.find(obj => obj.id === discountId && obj.type === 'DISCOUNT');
                        if (discountObj) {
                            discount = discountObj.discount_data;
                        } else {
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

                    if (discount) {
                        return { statusCode: 200, headers, body: JSON.stringify(buildDiscountResponse(upperCode, discount, matchingRule.pricing_rule_data)) };
                    }
                }
            }

            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, message: 'Invalid promo code' }) };
        }

        const discount = matchingDiscount.discount_data;

        // Check if there's a linked pricing rule with date restrictions
        // (Search for pricing rules that reference this discount)
        const prCheckResponse = await fetch(`${SQUARE_BASE_URL}/catalog/search`, {
            method: 'POST',
            headers: {
                'Square-Version': '2024-11-20',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                object_types: ['PRICING_RULE'],
                include_related_objects: false
            })
        });

        let pricingRuleData = null;
        if (prCheckResponse.ok) {
            const prData = await prCheckResponse.json();
            const linkedRule = (prData.objects || []).find(rule =>
                rule.pricing_rule_data?.discount_id === matchingDiscount.id
            );
            if (linkedRule) {
                pricingRuleData = linkedRule.pricing_rule_data;
            }
        }

        // Check validity dates from pricing rule if present
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
