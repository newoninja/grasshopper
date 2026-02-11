const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'dyette@icloud.com';
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';
const SALE_DISCOUNT = 0.20;
const NC_TAX_RATE = 0.0725;
const { getProductWeight, getUpsShippingCost } = require('./shipping-data');
const { fetchSquareJson, getCatalogObject, getLocationId } = require('./square-utils');
const { buildCorsHeaders, jsonResponse, methodNotAllowed, parseJsonBody } = require('./request-utils');
const { computeDiscountCents, resolvePromoCode } = require('./promo-utils');
const { sendEmail, buildCustomerReceiptHtml, buildOwnerNotificationText } = require('./gmail-utils');

function normalizeQuantity(value) {
  const qty = Number.parseInt(value, 10);
  if (!Number.isFinite(qty) || qty < 1 || qty > 100) return null;
  return qty;
}

function toSalePriceCents(squarePriceCents) {
  const dollarPrice = Math.round(squarePriceCents || 0) / 100;
  return Math.round(Math.round(dollarPrice * (1 - SALE_DISCOUNT)) * 100);
}

function safeString(value, max = 120) {
  return String(value || '').trim().slice(0, max);
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
    const { sourceId, items, orderType, phone, shippingAddress, promoCode, discountCents, taxCents } = parsed.body;
    if (!sourceId || !Array.isArray(items) || items.length === 0 || !orderType) {
      return jsonResponse(400, headers, { error: 'Missing required fields' });
    }
    if (!SQUARE_ACCESS_TOKEN) {
      return jsonResponse(500, headers, { error: 'Payment service not configured' });
    }

    const normalizedItems = [];
    let subtotalCents = 0;
    let totalWeight = 0;

    for (const rawItem of items) {
      const qty = normalizeQuantity(rawItem?.quantity);
      const variationId = safeString(rawItem?.variationId, 64);
      if (!qty || !variationId) {
        return jsonResponse(400, headers, { error: 'Invalid item payload' });
      }

      const variationObj = await getCatalogObject(SQUARE_ACCESS_TOKEN, variationId);
      if (!variationObj?.item_variation_data) {
        return jsonResponse(400, headers, { error: 'Invalid variation selected' });
      }

      const variationData = variationObj.item_variation_data;
      const parentItemId = variationData.item_id;
      if (!parentItemId) {
        return jsonResponse(400, headers, { error: 'Invalid catalog relationship for variation' });
      }

      const parentItem = await getCatalogObject(SQUARE_ACCESS_TOKEN, parentItemId);
      const productName = parentItem?.item_data?.name || safeString(rawItem?.name, 120) || 'Product';
      const variationName = safeString(variationData.name || 'Standard', 80) || 'Standard';
      const squarePriceCents = variationData.price_money?.amount;
      if (!Number.isFinite(squarePriceCents) || squarePriceCents <= 0) {
        return jsonResponse(400, headers, { error: 'Variation has invalid price' });
      }

      const unitPriceCents = toSalePriceCents(squarePriceCents);
      subtotalCents += unitPriceCents * qty;
      totalWeight += getProductWeight(productName, variationName) * qty;

      normalizedItems.push({
        quantity: qty,
        variationId,
        productName,
        variationName,
        unitPriceCents,
        displayName: variationName && variationName.toLowerCase() !== 'standard'
          ? `${productName} - ${variationName}`
          : productName
      });
    }

    let shippingAmount = 0;
    if (orderType !== 'pickup') {
      const destState = safeString(shippingAddress?.state || 'NY', 2).toUpperCase();
      shippingAmount = getUpsShippingCost(totalWeight, destState || 'NY');
    }

    let promoResponse = null;
    if (promoCode) {
      promoResponse = await resolvePromoCode(SQUARE_ACCESS_TOKEN, promoCode);
      if (!promoResponse.valid) {
        return jsonResponse(400, headers, { error: promoResponse.message || 'Invalid promo code' });
      }
    }

    const serverDiscount = computeDiscountCents({
      promoResponse,
      subtotalCents,
      shippingCents: shippingAmount
    });

    if (Number.isFinite(discountCents) && Math.abs(Math.round(discountCents) - serverDiscount.discountCents) > 1) {
      console.warn('Client discount mismatch ignored', {
        clientDiscountCents: Math.round(discountCents),
        serverDiscountCents: serverDiscount.discountCents
      });
    }

    const taxableAmount = Math.max(0, subtotalCents - serverDiscount.productDiscountCents);
    const serverTaxCents = Math.round(taxableAmount * NC_TAX_RATE);
    if (Number.isFinite(taxCents) && Math.abs(Math.round(taxCents) - serverTaxCents) > 1) {
      console.warn('Client tax mismatch ignored', {
        clientTaxCents: Math.round(taxCents),
        serverTaxCents
      });
    }

    const locationId = await getLocationId(SQUARE_ACCESS_TOKEN);
    const orderBody = {
      location_id: locationId,
      line_items: normalizedItems.map((item) => ({
        quantity: String(item.quantity),
        name: item.displayName,
        base_price_money: {
          amount: item.unitPriceCents,
          currency: 'USD'
        },
        item_type: 'ITEM'
      }))
    };

    const serviceCharges = [];
    if (shippingAmount > 0) {
      serviceCharges.push({
        name: 'Shipping',
        amount_money: { amount: shippingAmount, currency: 'USD' },
        calculation_phase: 'SUBTOTAL_PHASE'
      });
    }
    if (serverTaxCents > 0) {
      serviceCharges.push({
        name: 'NC Sales Tax (7.25%)',
        amount_money: { amount: serverTaxCents, currency: 'USD' },
        calculation_phase: 'SUBTOTAL_PHASE'
      });
    }
    if (serviceCharges.length > 0) {
      orderBody.service_charges = serviceCharges;
    }

    if (serverDiscount.discountCents > 0) {
      orderBody.discounts = [{
        name: serverDiscount.code || 'Discount',
        amount_money: { amount: serverDiscount.discountCents, currency: 'USD' },
        scope: 'ORDER'
      }];
    }

    if (shippingAddress && orderType !== 'pickup') {
      orderBody.fulfillments = [{
        type: 'SHIPMENT',
        state: 'PROPOSED',
        shipment_details: {
          recipient: {
            display_name: `${safeString(shippingAddress.firstName, 60)} ${safeString(shippingAddress.lastName, 60)}`.trim(),
            email_address: safeString(shippingAddress.email, 160) || undefined,
            address: {
              address_line_1: safeString(shippingAddress.street, 120),
              address_line_2: safeString(shippingAddress.apt, 120) || undefined,
              locality: safeString(shippingAddress.city, 80),
              administrative_district_level_1: safeString(shippingAddress.state, 2).toUpperCase(),
              postal_code: safeString(shippingAddress.zip, 10),
              country: 'US'
            }
          }
        }
      }];
    }

    const idempotencyBase = `${orderType}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const orderCreate = await fetchSquareJson(SQUARE_ACCESS_TOKEN, '/orders', {
      method: 'POST',
      body: {
        idempotency_key: `order-${idempotencyBase}`,
        order: orderBody
      }
    });
    if (!orderCreate.ok || !orderCreate.data.order) {
      const errorMsg = orderCreate.data.errors?.[0]?.detail || 'Failed to create order';
      return jsonResponse(400, headers, { error: errorMsg });
    }

    const orderId = orderCreate.data.order.id;
    const orderTotal = orderCreate.data.order.total_money?.amount || 0;
    const canUseFreeOrder = sourceId === 'FREE_ORDER' &&
      promoResponse?.valid &&
      serverDiscount.discountCents > 0 &&
      orderTotal === 0;

    if (sourceId === 'FREE_ORDER' && !canUseFreeOrder) {
      return jsonResponse(400, headers, { error: 'Invalid free order request' });
    }
    if (sourceId !== 'FREE_ORDER' && orderTotal === 0) {
      return jsonResponse(400, headers, { error: 'Order total is zero; retry with free order flow' });
    }

    let paymentData = { payment: null };
    if (canUseFreeOrder) {
      paymentData = { payment: { id: 'FREE', status: 'COMPLETED' } };
    } else {
      const paymentCreate = await fetchSquareJson(SQUARE_ACCESS_TOKEN, '/payments', {
        method: 'POST',
        body: {
          idempotency_key: `pay-${idempotencyBase}`,
          source_id: sourceId,
          amount_money: {
            amount: orderTotal,
            currency: 'USD'
          },
          order_id: orderId,
          location_id: locationId
        }
      });

      paymentData = paymentCreate.data;
      if (!paymentCreate.ok || !paymentData.payment || paymentData.payment.status === 'FAILED') {
        const errorMsg = paymentData.errors?.[0]?.detail || 'Payment failed';
        return jsonResponse(400, headers, { error: errorMsg });
      }
    }

    // Send email notifications
    try {
      const emailItems = normalizedItems.map(item => ({
        name: item.displayName,
        price: item.unitPriceCents / 100,
        quantity: item.quantity
      }));

      const emailData = {
        items: emailItems,
        subtotal: subtotalCents / 100,
        shipping: shippingAmount / 100,
        tax: serverTaxCents / 100,
        discount: serverDiscount.discountCents / 100,
        total: orderTotal / 100,
        orderId,
        paymentId: paymentData.payment.id,
        orderType,
        phone: phone || null,
        email: shippingAddress?.email || null,
        shippingAddress: shippingAddress || null,
        promoCode: serverDiscount.code || null
      };

      // Send owner notification
      await sendEmail({
        to: OWNER_EMAIL,
        subject: `New ${orderType === 'pickup' ? 'Pickup' : 'Shipping'} Order — ${paymentData.payment.id === 'FREE' ? 'FREE' : 'PAID'}`,
        textBody: buildOwnerNotificationText(emailData)
      });

      // Send customer receipt if we have their email
      if (shippingAddress?.email) {
        await sendEmail({
          to: shippingAddress.email,
          subject: 'Your Order from The Grasshopper',
          textBody: `Thank you for your order! Order #${orderId ? orderId.slice(-8).toUpperCase() : '---'}. Total: $${(orderTotal / 100).toFixed(2)}.`,
          htmlBody: buildCustomerReceiptHtml(emailData)
        });
      }
    } catch (emailError) {
      console.error('Email error:', emailError);
    }

    return jsonResponse(200, headers, {
      success: true,
      paymentId: paymentData.payment.id,
      orderId,
      receiptUrl: paymentData.payment.receipt_url || null
    });
  } catch (error) {
    console.error('Process payment error:', error);
    return jsonResponse(500, headers, { error: 'Payment processing failed' });
  }
};
