// ============================================
// Square Web Payments SDK - Checkout Handler
// ============================================

let payments = null;
let card = null;
let applePay = null;
let googlePay = null;
let checkoutData = null;
let discountCents = 0;
let appliedPromo = null;

// ============================================
// Initialize
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode') || 'shipping';

    // Load checkout data from localStorage
    checkoutData = loadCheckoutData(mode);

    if (!checkoutData || !checkoutData.items.length) {
        showError('Your cart is empty. Please add items before checking out.');
        return;
    }

    // Hide address section for pickup
    if (mode === 'pickup') {
        document.getElementById('addressSection').style.display = 'none';
    }

    renderOrderSummary(checkoutData);

    // Calculate shipping if not pickup
    if (mode !== 'pickup') {
        await calculateShipping(checkoutData.items);
    } else {
        document.getElementById('checkoutShipping').textContent = '$0.00 (Pickup)';
        updateTotal();
    }

    // Initialize Square payments
    try {
        const config = await fetchConfig();
        await initializePayments(config, checkoutData);
    } catch (err) {
        console.error('Payment init error:', err);
        showPaymentError('Unable to load payment form. Please refresh and try again.');
    }
});

// ============================================
// Data Loading
// ============================================

function loadCheckoutData(mode) {
    const cart = JSON.parse(localStorage.getItem('grasshopper-cart')) || [];

    if (mode === 'quick') {
        const quickItem = JSON.parse(localStorage.getItem('grasshopper-quick-buy'));
        if (!quickItem) return null;
        return {
            mode: 'quick',
            items: [quickItem],
            phone: null
        };
    }

    if (mode === 'pickup') {
        const phone = localStorage.getItem('grasshopper-pickup-phone') || '';
        return {
            mode: 'pickup',
            items: cart,
            phone: phone
        };
    }

    // Default: shipping (full cart)
    return {
        mode: 'shipping',
        items: cart,
        phone: null
    };
}

async function fetchConfig() {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Failed to load config');
    return await response.json();
}

// ============================================
// Order Summary Rendering
// ============================================

function renderOrderSummary(data) {
    const container = document.getElementById('checkoutItems');
    const subtotalEl = document.getElementById('checkoutSubtotal');

    if (!data.items.length) {
        container.innerHTML = '<p class="checkout-empty">No items</p>';
        return;
    }

    container.innerHTML = data.items.map((item, index) => `
        <div class="checkout-item">
            <div class="checkout-item-image">
                ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${escapeHtml(item.name)}">` : ''}
            </div>
            <div class="checkout-item-info">
                <p class="checkout-item-name">${escapeHtml(item.name)}</p>
                <div class="checkout-item-controls">
                    <button class="checkout-qty-btn" onclick="changeQty(${index}, -1)">-</button>
                    <span class="checkout-item-qty">${item.quantity || 1}</span>
                    <button class="checkout-qty-btn" onclick="changeQty(${index}, 1)">+</button>
                    <button class="checkout-remove-btn" onclick="removeItem(${index})">Remove</button>
                </div>
            </div>
            <p class="checkout-item-price">$${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</p>
        </div>
    `).join('');

    const subtotal = data.items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
    subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
}

// ============================================
// Cart Editing on Checkout
// ============================================

function changeQty(index, delta) {
    const item = checkoutData.items[index];
    if (!item) return;

    item.quantity = (item.quantity || 1) + delta;
    if (item.quantity <= 0) {
        removeItem(index);
        return;
    }

    syncCartToStorage();
    renderOrderSummary(checkoutData);
    recalcAndUpdateTotal();
}

function removeItem(index) {
    checkoutData.items.splice(index, 1);

    if (checkoutData.items.length === 0) {
        showError('Your cart is empty. Please add items before checking out.');
        return;
    }

    syncCartToStorage();
    renderOrderSummary(checkoutData);
    recalcAndUpdateTotal();
}

function syncCartToStorage() {
    if (checkoutData.mode === 'quick') {
        localStorage.setItem('grasshopper-quick-buy', JSON.stringify(checkoutData.items[0]));
    } else {
        localStorage.setItem('grasshopper-cart', JSON.stringify(checkoutData.items));
    }
}

async function recalcAndUpdateTotal() {
    if (checkoutData.mode !== 'pickup') {
        await calculateShipping(checkoutData.items);
    } else {
        updateTotal();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Promo Code
// ============================================

async function applyPromo() {
    const input = document.getElementById('promoInput');
    const msg = document.getElementById('promoMessage');
    const code = input.value.trim().toUpperCase();

    if (!code) {
        msg.textContent = 'Please enter a promo code';
        msg.className = 'promo-message promo-error';
        return;
    }

    try {
        const response = await fetch('/api/validate-promo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        const data = await response.json();

        if (data.valid) {
            appliedPromo = data;
            const subtotal = checkoutData.items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);

            if (data.type === 'percent') {
                discountCents = Math.round(subtotal * 100 * data.value / 100);
            } else {
                discountCents = data.value;
            }

            const discountLine = document.getElementById('discountLine');
            discountLine.style.display = 'flex';
            document.getElementById('checkoutDiscount').textContent = `-$${(discountCents / 100).toFixed(2)}`;

            msg.textContent = data.message || `Code "${code}" applied!`;
            msg.className = 'promo-message promo-success';
            input.disabled = true;
            document.getElementById('promoApplyBtn').textContent = 'Applied';
            document.getElementById('promoApplyBtn').disabled = true;

            updateTotal();
        } else {
            msg.textContent = data.message || 'Invalid promo code';
            msg.className = 'promo-message promo-error';
        }
    } catch (err) {
        msg.textContent = 'Unable to validate code. Try again.';
        msg.className = 'promo-message promo-error';
    }
}

// ============================================
// Shipping Calculation
// ============================================

async function calculateShipping(items) {
    const shippingEl = document.getElementById('checkoutShipping');

    try {
        const response = await fetch('/api/calculate-shipping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: items.map(item => ({
                    variationId: item.variationId,
                    quantity: item.quantity || 1
                }))
            })
        });

        const data = await response.json();
        const shippingDollars = (data.shippingAmount || 0) / 100;
        shippingEl.textContent = `$${shippingDollars.toFixed(2)}`;
        shippingEl.dataset.cents = data.shippingAmount || 0;
    } catch (err) {
        console.error('Shipping calc error:', err);
        // Fallback: $7.50 per item
        const fallback = items.reduce((sum, item) => sum + (750 * (item.quantity || 1)), 0);
        const shippingDollars = fallback / 100;
        shippingEl.textContent = `$${shippingDollars.toFixed(2)}`;
        shippingEl.dataset.cents = fallback;
    }

    updateTotal();
}

function updateTotal() {
    const subtotal = checkoutData.items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
    const shippingEl = document.getElementById('checkoutShipping');
    const shippingCents = parseInt(shippingEl.dataset.cents || '0', 10);
    const subtotalCents = Math.round(subtotal * 100);
    const totalCents = subtotalCents + shippingCents - discountCents;
    const total = Math.max(0, totalCents) / 100;

    document.getElementById('checkoutTotal').textContent = `$${total.toFixed(2)}`;
}

// ============================================
// Address Validation
// ============================================

function getShippingAddress() {
    if (checkoutData.mode === 'pickup') return null;

    const firstName = document.getElementById('addrFirstName').value.trim();
    const lastName = document.getElementById('addrLastName').value.trim();
    const email = document.getElementById('addrEmail').value.trim();
    const street = document.getElementById('addrStreet').value.trim();
    const apt = document.getElementById('addrApt').value.trim();
    const city = document.getElementById('addrCity').value.trim();
    const state = document.getElementById('addrState').value;
    const zip = document.getElementById('addrZip').value.trim();

    return { firstName, lastName, email, street, apt, city, state, zip };
}

function validateAddress() {
    if (checkoutData.mode === 'pickup') return true;

    const addr = getShippingAddress();
    const missing = [];
    if (!addr.firstName) missing.push('first name');
    if (!addr.lastName) missing.push('last name');
    if (!addr.email) missing.push('email');
    if (!addr.street) missing.push('street address');
    if (!addr.city) missing.push('city');
    if (!addr.state) missing.push('state');
    if (!addr.zip || addr.zip.length !== 5) missing.push('ZIP code');

    if (missing.length) {
        showPaymentError('Please fill in: ' + missing.join(', '));
        return false;
    }

    // Basic email check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.email)) {
        showPaymentError('Please enter a valid email address');
        return false;
    }

    return true;
}

// ============================================
// Square Payments SDK
// ============================================

async function initializePayments(config, data) {
    if (!window.Square) {
        await loadScript('https://web.squarecdn.com/v1/square.js');
    }

    payments = window.Square.payments(config.applicationId, config.locationId);

    // Initialize card
    card = await payments.card();
    await card.attach('#card-container');

    // Enable pay button
    const payBtn = document.getElementById('payButton');
    payBtn.disabled = false;
    payBtn.addEventListener('click', handlePayment);

    // Initialize Apple Pay
    try {
        const paymentRequest = buildPaymentRequest(data);
        applePay = await payments.applePay(paymentRequest);
        await applePay.attach('#apple-pay-button');
        document.getElementById('apple-pay-button').style.display = 'block';
        showWalletButtons();
    } catch (e) {
        console.log('Apple Pay not available:', e.message);
    }

    // Initialize Google Pay
    try {
        const paymentRequest = buildPaymentRequest(data);
        googlePay = await payments.googlePay(paymentRequest);
        await googlePay.attach('#google-pay-button');
        document.getElementById('google-pay-button').style.display = 'block';
        showWalletButtons();
    } catch (e) {
        console.log('Google Pay not available:', e.message);
    }
}

function buildPaymentRequest(data) {
    const subtotal = data.items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
    const shippingEl = document.getElementById('checkoutShipping');
    const shippingCents = parseInt(shippingEl.dataset.cents || '0', 10);
    const subtotalCents = Math.round(subtotal * 100);
    const totalCents = subtotalCents + shippingCents - discountCents;
    const total = (Math.max(0, totalCents) / 100).toFixed(2);

    return payments.paymentRequest({
        countryCode: 'US',
        currencyCode: 'USD',
        total: {
            amount: total,
            label: 'The Grasshopper'
        }
    });
}

function showWalletButtons() {
    document.getElementById('walletButtons').style.display = 'block';
}

// ============================================
// Payment Handlers
// ============================================

async function handlePayment() {
    hidePaymentError();

    if (!validateAddress()) return;

    setPayButtonLoading(true);

    try {
        const result = await card.tokenize();
        if (result.status === 'OK') {
            await processPayment(result.token);
        } else {
            const errorMsg = result.errors?.map(e => e.message).join(', ') || 'Card validation failed';
            showPaymentError(errorMsg);
            setPayButtonLoading(false);
        }
    } catch (err) {
        console.error('Tokenization error:', err);
        showPaymentError('Unable to process card. Please check your details and try again.');
        setPayButtonLoading(false);
    }
}

async function handleWalletPayment(walletMethod) {
    hidePaymentError();

    // For wallet payments, address validation is optional since wallets provide address
    setPayButtonLoading(true);

    try {
        const result = await walletMethod.tokenize();
        if (result.status === 'OK') {
            await processPayment(result.token);
        } else {
            showPaymentError('Wallet payment cancelled or failed.');
            setPayButtonLoading(false);
        }
    } catch (err) {
        console.error('Wallet payment error:', err);
        showPaymentError('Wallet payment failed. Please try with a card.');
        setPayButtonLoading(false);
    }
}

async function processPayment(sourceId) {
    try {
        const address = getShippingAddress();

        const body = {
            sourceId: sourceId,
            items: checkoutData.items.map(item => ({
                variationId: item.variationId,
                quantity: item.quantity || 1,
                name: item.name,
                price: item.price
            })),
            orderType: checkoutData.mode,
            phone: checkoutData.phone || null
        };

        if (address) {
            body.shippingAddress = address;
        }

        if (appliedPromo) {
            body.promoCode = appliedPromo.code;
            body.discountCents = discountCents;
        }

        const response = await fetch('/api/process-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (data.success) {
            showSuccess(data);
            clearCheckoutData();
        } else {
            showPaymentError(data.error || 'Payment failed. Please try again.');
            setPayButtonLoading(false);
        }
    } catch (err) {
        console.error('Process payment error:', err);
        showPaymentError('Payment processing failed. Please try again.');
        setPayButtonLoading(false);
    }
}

// ============================================
// UI State Management
// ============================================

function setPayButtonLoading(loading) {
    const payBtn = document.getElementById('payButton');
    const btnText = payBtn.querySelector('.pay-btn-text');
    const btnLoading = payBtn.querySelector('.pay-btn-loading');

    payBtn.disabled = loading;
    btnText.style.display = loading ? 'none' : '';
    btnLoading.style.display = loading ? 'inline-flex' : 'none';
}

function showPaymentError(message) {
    const errDiv = document.getElementById('paymentErrors');
    errDiv.textContent = message;
    errDiv.style.display = 'block';
}

function hidePaymentError() {
    document.getElementById('paymentErrors').style.display = 'none';
}

function showSuccess(data) {
    document.querySelector('.checkout-layout').style.display = 'none';
    document.querySelector('.checkout-title').style.display = 'none';

    const successDiv = document.getElementById('checkoutSuccess');
    successDiv.style.display = 'block';

    if (checkoutData.mode === 'pickup') {
        document.getElementById('successMessage').textContent =
            'Your order has been placed! We\'ll contact you within 24 hours to arrange pickup.';
    }

    if (data.receiptUrl) {
        const receiptLink = document.getElementById('receiptLink');
        receiptLink.href = data.receiptUrl;
        receiptLink.style.display = 'inline-block';
    }
}

function showError(message) {
    document.querySelector('.checkout-layout').style.display = 'none';
    document.querySelector('.checkout-title').style.display = 'none';

    const errorDiv = document.getElementById('checkoutError');
    document.getElementById('errorMessage').textContent = message;
    errorDiv.style.display = 'block';
}

function clearCheckoutData() {
    if (checkoutData.mode !== 'quick') {
        localStorage.removeItem('grasshopper-cart');
    }
    localStorage.removeItem('grasshopper-quick-buy');
    localStorage.removeItem('grasshopper-pickup-phone');
}

// ============================================
// Utility
// ============================================

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}
