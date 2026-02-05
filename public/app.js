// ============================================
// The Grasshopper - Main Application
// ============================================

let cart = JSON.parse(localStorage.getItem('grasshopper-cart')) || [];
let allProducts = [];
let pickupEligible = false;
let pickupPhone = '';

// ============================================
// API Functions
// ============================================

async function fetchProducts() {
    const response = await fetch('/api/products');
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('API Error:', errorData);
        throw new Error(errorData.error || 'Failed to fetch products');
    }
    allProducts = await response.json();
    return allProducts;
}

async function fetchProduct(id) {
    const response = await fetch(`/api/product?id=${id}`);
    if (!response.ok) throw new Error('Failed to fetch product');
    return await response.json();
}

async function searchProducts(query) {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Failed to search');
    return await response.json();
}

async function checkPickupEligibility() {
    const zipCode = document.getElementById('pickupZip').value.trim();
    const resultDiv = document.getElementById('pickupResult');

    if (!zipCode || zipCode.length !== 5) {
        resultDiv.innerHTML = '<p class="pickup-error">Please enter a valid 5-digit zip code</p>';
        return;
    }

    resultDiv.innerHTML = '<p class="pickup-checking">Checking...</p>';

    try {
        const response = await fetch('/api/check-pickup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zipCode })
        });

        const data = await response.json();

        if (data.eligible) {
            pickupEligible = true;
            resultDiv.innerHTML = `
                <div class="pickup-eligible">
                    <h4>✓ Great news! Local pickup is available</h4>
                    <p>Please provide your phone number and we'll contact you within 24 hours to arrange pickup.</p>
                    <input type="tel" id="pickupPhoneInput" class="pickup-phone-input"
                           placeholder="(555) 123-4567" maxlength="14" />
                    <button class="confirm-pickup-btn" onclick="confirmPickup()">Confirm Pickup Order</button>
                    <button class="pickup-cancel-btn" onclick="closePickupModal()">Cancel</button>
                </div>
            `;
        } else {
            pickupEligible = false;
            resultDiv.innerHTML = `
                <div class="pickup-not-eligible">
                    <h4>Sorry, you're outside our pickup area</h4>
                    <p>We offer shipping to your location. Click checkout to proceed with delivery.</p>
                    <button class="pickup-ok-btn" onclick="closePickupModal(); createCheckout();">Proceed to Checkout</button>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error checking pickup:', error);
        resultDiv.innerHTML = '<p class="pickup-error">Unable to check eligibility. Please try again.</p>';
    }
}

async function confirmPickup() {
    const phoneInput = document.getElementById('pickupPhoneInput');
    const phone = phoneInput?.value.trim();

    if (!phone || phone.length < 10) {
        alert('Please enter a valid phone number');
        return;
    }

    pickupPhone = phone;

    // Show processing state
    const confirmBtn = document.querySelector('.confirm-pickup-btn');
    const originalText = confirmBtn.textContent;
    confirmBtn.textContent = 'Processing...';
    confirmBtn.disabled = true;

    try {
        const items = cart.map(item => ({
            variationId: item.variationId,
            quantity: item.quantity,
            name: item.name,
            price: item.price
        }));

        const response = await fetch('/api/checkout-pickup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, phone })
        });

        const data = await response.json();

        if (data.checkoutUrl) {
            // Redirect to Square checkout
            window.location.href = data.checkoutUrl;
        } else {
            const errorMsg = data.error || 'Unable to create pickup order. Please try again.';
            console.error('Pickup checkout error:', data);
            alert(errorMsg);
            confirmBtn.textContent = originalText;
            confirmBtn.disabled = false;
        }
    } catch (error) {
        console.error('Pickup checkout error:', error);
        alert('Unable to process pickup order. Please try again.');
        confirmBtn.textContent = originalText;
        confirmBtn.disabled = false;
    }
}

function openPickupModal() {
    document.querySelector('.pickup-modal')?.classList.add('active');
    document.querySelector('.pickup-overlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closePickupModal() {
    document.querySelector('.pickup-modal')?.classList.remove('active');
    document.querySelector('.pickup-overlay')?.classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('pickupResult').innerHTML = '';
    document.getElementById('pickupZip').value = '';
}

async function createCheckout() {
    if (cart.length === 0) return;

    const checkoutBtn = document.getElementById('checkoutBtn');
    checkoutBtn.textContent = 'Processing...';
    checkoutBtn.disabled = true;

    try {
        const items = cart.map(item => ({
            variationId: item.variationId,
            quantity: item.quantity
        }));

        const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });

        const data = await response.json();

        if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
        } else {
            alert('Unable to create checkout. Please try again.');
            checkoutBtn.textContent = 'Checkout';
            checkoutBtn.disabled = false;
        }
    } catch (error) {
        console.error('Checkout error:', error);
        alert('Checkout failed. Please try again.');
        checkoutBtn.textContent = 'Checkout';
        checkoutBtn.disabled = false;
    }
}

async function buyNow(variationId) {
    try {
        const response = await fetch('/api/checkout-quick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variationId, quantity: 1 })
        });

        const data = await response.json();
        if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
        } else {
            alert('Unable to process. Please try again.');
        }
    } catch (error) {
        console.error('Buy now error:', error);
        alert('Unable to process. Please try again.');
    }
}

// ============================================
// Product Card Creation
// ============================================

function createProductCard(product, fullSize = false) {
    const imageHtml = product.imageUrl
        ? `<img src="${product.imageUrl}" alt="${escapeHtml(product.name)}" loading="lazy">`
        : `<div class="product-image-placeholder">No Image</div>`;

    return `
        <article class="product-card${fullSize ? ' full-size' : ''}" data-product-id="${product.id}">
            <a href="product.html?id=${product.id}" class="product-image-link">
                <div class="product-image">${imageHtml}</div>
            </a>
            <div class="product-info">
                <a href="product.html?id=${product.id}" class="product-name-link">
                    <h3 class="product-name">${escapeHtml(product.name)}</h3>
                </a>
                <p class="product-price">$${product.price.toFixed(2)}</p>
                <div class="product-buttons">
                    <button class="add-to-cart-btn" onclick="event.stopPropagation(); addToCart('${product.id}')">Add to Cart</button>
                    <button class="buy-now-btn-small" onclick="event.stopPropagation(); buyNow('${product.variationId}')">Buy Now</button>
                </div>
            </div>
        </article>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Cart Functions
// ============================================

function addToCart(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const existingItem = cart.find(item => item.id === productId);

    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({
            id: product.id,
            variationId: product.variationId,
            name: product.name,
            price: product.price,
            imageUrl: product.imageUrl,
            quantity: 1
        });
    }

    saveCart();
    updateCartUI();
    openCart();
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    saveCart();
    updateCartUI();
}

function updateQuantity(productId, delta) {
    const item = cart.find(item => item.id === productId);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
        removeFromCart(productId);
    } else {
        saveCart();
        updateCartUI();
    }
}

function saveCart() {
    localStorage.setItem('grasshopper-cart', JSON.stringify(cart));
}

function updateCartUI() {
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    const cartShipping = document.getElementById('cartShipping');
    const cartCount = document.querySelector('.cart-count');
    const checkoutBtn = document.getElementById('checkoutBtn');

    if (!cartItems) return;

    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (cartCount) {
        cartCount.textContent = totalItems;
        cartCount.classList.toggle('visible', totalItems > 0);
    }

    if (cartShipping) cartShipping.textContent = totalItems > 0 ? 'Calculated at checkout' : '$0.00';
    if (cartTotal) cartTotal.textContent = `$${subtotal.toFixed(2)}`;
    if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;

    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="cart-empty">Your cart is empty</p>';
        return;
    }

    cartItems.innerHTML = cart.map(item => `
        <div class="cart-item">
            <div class="cart-item-image">
                ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${escapeHtml(item.name)}">` : ''}
            </div>
            <div class="cart-item-details">
                <p class="cart-item-name">${escapeHtml(item.name)}</p>
                <p class="cart-item-price">$${item.price.toFixed(2)}</p>
                <div class="cart-item-actions">
                    <button class="quantity-btn" onclick="updateQuantity('${item.id}', -1)">−</button>
                    <span class="cart-item-quantity">${item.quantity}</span>
                    <button class="quantity-btn" onclick="updateQuantity('${item.id}', 1)">+</button>
                    <button class="cart-item-remove" onclick="removeFromCart('${item.id}')">Remove</button>
                </div>
            </div>
        </div>
    `).join('');
}

// ============================================
// UI Functions
// ============================================

function openCart() {
    document.querySelector('.cart-sidebar')?.classList.add('active');
    document.querySelector('.cart-overlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeCart() {
    document.querySelector('.cart-sidebar')?.classList.remove('active');
    document.querySelector('.cart-overlay')?.classList.remove('active');
    document.body.style.overflow = '';
}

function openSearch() {
    document.querySelector('.search-overlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('searchInput')?.focus(), 100);
}

function closeSearch() {
    document.querySelector('.search-overlay')?.classList.remove('active');
    document.body.style.overflow = '';
    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    if (input) input.value = '';
    if (results) results.innerHTML = '';
}

async function handleSearch(event) {
    event.preventDefault();
    const query = document.getElementById('searchInput').value.trim();
    const resultsContainer = document.getElementById('searchResults');
    if (!query) return;

    resultsContainer.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    try {
        const results = await searchProducts(query);
        if (results.length === 0) {
            resultsContainer.innerHTML = '<p class="search-no-results">No products found</p>';
            return;
        }

        resultsContainer.innerHTML = results.map(product => `
            <div class="search-result-item" onclick="goToProduct('${product.id}')">
                <div class="search-result-image">
                    ${product.imageUrl ? `<img src="${product.imageUrl}" alt="${escapeHtml(product.name)}">` : ''}
                </div>
                <div class="search-result-info">
                    <p class="search-result-name">${escapeHtml(product.name)}</p>
                    <p class="search-result-price">$${product.price.toFixed(2)}</p>
                </div>
            </div>
        `).join('');

        allProducts = [...new Map([...allProducts, ...results].map(p => [p.id, p])).values()];
    } catch (error) {
        resultsContainer.innerHTML = '<p class="search-no-results">Search failed. Please try again.</p>';
    }
}

function goToProduct(productId) {
    closeSearch();
    window.location.href = `product.html?id=${productId}`;
}

// ============================================
// Event Listeners
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    updateCartUI();

    document.querySelector('.cart-toggle')?.addEventListener('click', openCart);
    document.querySelector('.cart-close')?.addEventListener('click', closeCart);
    document.querySelector('.cart-overlay')?.addEventListener('click', closeCart);
    document.querySelector('.search-toggle')?.addEventListener('click', openSearch);
    document.querySelector('.search-close')?.addEventListener('click', closeSearch);
    document.querySelector('.search-overlay')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('search-overlay')) closeSearch();
    });
    document.getElementById('checkoutBtn')?.addEventListener('click', createCheckout);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeCart(); closeSearch(); }
    });
});
