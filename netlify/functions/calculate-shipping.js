const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const { getProductWeight, getUpsShippingCost } = require('./shipping-data');
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';
const { getCatalogObject } = require('./square-utils');
const { buildCorsHeaders, jsonResponse, methodNotAllowed, parseJsonBody } = require('./request-utils');

function normalizeQuantity(value) {
  const qty = Number.parseInt(value, 10);
  if (!Number.isFinite(qty) || qty < 1 || qty > 100) return null;
  return qty;
}

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
    const { items, destinationState } = parsed.body;
    if (!Array.isArray(items) || items.length === 0) {
      return jsonResponse(400, headers, { error: 'No items provided' });
    }
    const state = String(destinationState || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) {
      return jsonResponse(400, headers, { error: 'Destination state is required' });
    }
    if (!SQUARE_ACCESS_TOKEN) {
      return jsonResponse(500, headers, { error: 'Shipping service not configured' });
    }

    let totalWeight = 0;
    for (const item of items) {
      const variationId = String(item?.variationId || '').trim();
      const qty = normalizeQuantity(item?.quantity);
      if (!variationId || !qty) {
        return jsonResponse(400, headers, { error: 'Invalid item data for shipping' });
      }

      try {
        const variationObj = await getCatalogObject(SQUARE_ACCESS_TOKEN, variationId);
        const variationName = variationObj?.item_variation_data?.name || 'Standard';
        const itemId = variationObj?.item_variation_data?.item_id;
        if (!itemId) {
          return jsonResponse(400, headers, { error: 'Unable to calculate shipping for selected item' });
        }
        const parentItem = await getCatalogObject(SQUARE_ACCESS_TOKEN, itemId);
        const productName = parentItem?.item_data?.name || '';
        totalWeight += getProductWeight(productName, variationName) * qty;
      } catch (err) {
        console.error('Error fetching product for shipping:', err);
        return jsonResponse(502, headers, { error: 'Unable to calculate shipping for selected item' });
      }
    }

    const shippingAmount = getUpsShippingCost(totalWeight, state);
    return jsonResponse(200, headers, {
      shippingAmount,
      totalWeight: Math.round(totalWeight * 10) / 10
    });
  } catch (error) {
    console.error('Calculate shipping error:', error);
    return jsonResponse(500, headers, { error: 'Failed to calculate shipping' });
  }
};
