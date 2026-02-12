const { fetchSquareJson } = require('./square-utils');

async function resolvePromoCode(accessToken, code) {
  const upperCode = String(code || '').toUpperCase().trim();
  if (!upperCode) {
    return { valid: false, message: 'Please enter a promo code' };
  }

  const { ok, data } = await fetchSquareJson(accessToken, '/catalog/search', {
    method: 'POST',
    version: '2024-11-20',
    body: {
      object_types: ['DISCOUNT', 'PRICING_RULE', 'PRODUCT_SET'],
      include_related_objects: true
    }
  });

  if (!ok) {
    return { valid: false, message: 'Unable to validate promo code. Please try again.' };
  }

  const allObjects = data.objects || [];
  const relatedObjects = data.related_objects || [];
  const allCombined = [...allObjects, ...relatedObjects];

  const discounts = allCombined.filter((obj) => obj.type === 'DISCOUNT');
  const pricingRules = allCombined.filter((obj) => obj.type === 'PRICING_RULE');

  let matchedDiscount = discounts.find((discountObj) =>
    discountObj.discount_data?.name?.toUpperCase()?.trim() === upperCode
  );
  let matchedRule = null;

  if (!matchedDiscount) {
    matchedRule = pricingRules.find((ruleObj) =>
      ruleObj.pricing_rule_data?.name?.toUpperCase()?.trim() === upperCode
    );

    if (matchedRule) {
      const discountId = matchedRule.pricing_rule_data?.discount_id;
      if (discountId) {
        matchedDiscount = allCombined.find((obj) => obj.id === discountId && obj.type === 'DISCOUNT');
        if (!matchedDiscount) {
          const directDiscount = await fetchSquareJson(accessToken, `/catalog/object/${encodeURIComponent(discountId)}`, {
            version: '2024-11-20'
          });
          if (directDiscount.ok) matchedDiscount = directDiscount.data.object;
        }
      }
    }
  }

  if (!matchedDiscount && !matchedRule) {
    matchedDiscount = discounts.find((discountObj) => {
      const name = discountObj.discount_data?.name?.toUpperCase()?.trim() || '';
      return name.includes(upperCode) || upperCode.includes(name);
    });

    if (!matchedDiscount) {
      matchedRule = pricingRules.find((ruleObj) => {
        const name = ruleObj.pricing_rule_data?.name?.toUpperCase()?.trim() || '';
        return name.includes(upperCode) || upperCode.includes(name);
      });

      if (matchedRule) {
        const discountId = matchedRule.pricing_rule_data?.discount_id;
        if (discountId) {
          matchedDiscount = allCombined.find((obj) => obj.id === discountId && obj.type === 'DISCOUNT');
          if (!matchedDiscount) {
            const directDiscount = await fetchSquareJson(accessToken, `/catalog/object/${encodeURIComponent(discountId)}`, {
              version: '2024-11-20'
            });
            if (directDiscount.ok) matchedDiscount = directDiscount.data.object;
          }
        }
      }
    }
  }

  if (!matchedDiscount) {
    return { valid: false, message: 'Invalid promo code' };
  }

  if (!matchedRule) {
    matchedRule = pricingRules.find((ruleObj) => ruleObj.pricing_rule_data?.discount_id === matchedDiscount.id);
  }

  const pricingRuleData = matchedRule?.pricing_rule_data || null;
  if (pricingRuleData) {
    const today = new Date().toISOString().split('T')[0];
    const validFrom = pricingRuleData.valid_from_date;
    const validUntil = pricingRuleData.valid_until_date;

    if (validFrom && today < validFrom) {
      return { valid: false, message: 'This promo code is not yet active' };
    }
    if (validUntil && today > validUntil) {
      return { valid: false, message: 'This promo code has expired' };
    }
  }

  const discount = matchedDiscount.discount_data || {};
  return {
    valid: true,
    code: upperCode,
    discount,
    pricingRuleData
  };
}

function buildDiscountResponse(resolvedPromo) {
  const code = resolvedPromo.code;
  const discount = resolvedPromo.discount || {};
  const result = { valid: true, code, freeShipping: false };
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

function computeDiscountCents({ promoResponse, subtotalCents, shippingCents }) {
  const discountSummary = {
    code: null,
    discountCents: 0,
    productDiscountCents: 0,
    freeShipping: false
  };

  if (!promoResponse?.valid) {
    return discountSummary;
  }

  const normalizedSubtotal = Math.max(0, Math.round(subtotalCents || 0));
  const normalizedShipping = Math.max(0, Math.round(shippingCents || 0));
  const serverPromo = buildDiscountResponse(promoResponse);
  discountSummary.code = serverPromo.code;
  discountSummary.freeShipping = !!serverPromo.freeShipping;

  if (serverPromo.freeShipping) {
    discountSummary.discountCents = normalizedShipping;
    return discountSummary;
  }

  if (serverPromo.type === 'percent') {
    discountSummary.discountCents = Math.round((normalizedSubtotal + normalizedShipping) * (serverPromo.value / 100));
    return discountSummary;
  }

  const fixedAmount = Math.max(0, Math.round(serverPromo.value || 0));
  discountSummary.discountCents = Math.min(fixedAmount, normalizedSubtotal + normalizedShipping);
  return discountSummary;
}

module.exports = {
  buildDiscountResponse,
  computeDiscountCents,
  resolvePromoCode
};
