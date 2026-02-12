// ============================================
// The Grasshopper - Main Application
// ============================================

// Site-wide sale config
const SALE_ACTIVE = true;
const SALE_DISCOUNT = 0.20;
const SALE_LABEL = '20% OFF';
const SALE_BANNER_TEXT = '20% OFF EVERYTHING — SITE-WIDE SALE';

let cart = JSON.parse(localStorage.getItem('grasshopper-cart')) || [];
let allProducts = [];
let pickupEligible = false;
let pickupPhone = '';

// Migrate old cart items: ensure originalPrice exists and all prices are rounded whole dollars
cart = cart.map(item => {
    if (!item.originalPrice && SALE_ACTIVE) {
        // Old item without originalPrice — price IS the original Square price
        item.originalPrice = Math.round(item.price);
        item.price = Math.round(item.price * (1 - SALE_DISCOUNT));
    } else if (item.originalPrice) {
        item.originalPrice = Math.round(item.originalPrice);
        item.price = SALE_ACTIVE ? Math.round(item.originalPrice * (1 - SALE_DISCOUNT)) : item.originalPrice;
    } else {
        item.price = Math.round(item.price);
    }
    return item;
});
localStorage.setItem('grasshopper-cart', JSON.stringify(cart));

function salePrice(price) {
    return SALE_ACTIVE ? Math.round(price * (1 - SALE_DISCOUNT)) : Math.round(price);
}

function salePriceHtml(price) {
    if (!SALE_ACTIVE) return `$${Math.round(price)}`;
    return `<span class="price-original">$${Math.round(price)}</span> <span class="price-sale">$${salePrice(price)}</span>`;
}

function salePriceRangeHtml(min, max) {
    if (!SALE_ACTIVE) return `$${Math.round(min)} - $${Math.round(max)}`;
    return `<span class="price-original">$${Math.round(min)} - $${Math.round(max)}</span> <span class="price-sale">$${salePrice(min)} - $${salePrice(max)}</span>`;
}

function escapeAttr(value) {
    return escapeHtml(String(value || '')).replace(/"/g, '&quot;');
}

function safeProductHref(productId) {
    return `product.html?id=${encodeURIComponent(String(productId || ''))}`;
}

function safeImageUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.href;
        }
    } catch (_error) {
        return '';
    }
    return '';
}

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

let searchAbortController = null;
async function searchProducts(query) {
    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: searchAbortController.signal
    });
    if (!response.ok) throw new Error('Failed to search');
    return await response.json();
}

async function checkPickupEligibility() {
    const zipCode = document.getElementById('pickupZip').value.trim();
    const resultDiv = document.getElementById('pickupResult');

    if (!zipCode || !/^\d{5}$/.test(zipCode)) {
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

    const phoneDigits = (phone || '').replace(/\D/g, '');
    if (!phone || phoneDigits.length < 10) {
        alert('Please enter a valid phone number');
        return;
    }

    pickupPhone = phone;
    localStorage.setItem('grasshopper-pickup-phone', phone);
    closePickupModal();
    closeCart();
    window.location.href = 'checkout.html?mode=pickup';
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
    closeCart();
    window.location.href = 'checkout.html?mode=shipping';
}

async function buyNow(variationId) {
    // Find product info for the quick buy item
    const product = allProducts.find(p => {
        if (p.variationId === variationId) return true;
        return p.variations?.some(v => v.id === variationId);
    });

    if (!product) {
        alert('Unable to process. Please try again.');
        return;
    }

    const variation = product.variations?.find(v => v.id === variationId);
    const originalPrice = variation ? variation.price : product.price;
    const quickItem = {
        id: product.id,
        variationId: variationId,
        name: product.name + (variation ? ` - ${variation.name}` : ''),
        price: salePrice(originalPrice),
        originalPrice: Math.round(originalPrice),
        imageUrl: product.imageUrl,
        quantity: 1
    };

    localStorage.setItem('grasshopper-quick-buy', JSON.stringify(quickItem));
    window.location.href = 'checkout.html?mode=quick';
}

// ============================================
// Product Card Creation
// ============================================

function createProductCard(product, fullSize = false) {
    const productHref = safeProductHref(product.id);
    const imageUrl = safeImageUrl(product.imageUrl);
    const imageHtml = imageUrl
        ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(product.name)}" loading="lazy">`
        : `<div class="product-image-placeholder">No Image</div>`;

    const priceHtml = product.priceRange
        ? salePriceRangeHtml(product.priceRange.min, product.priceRange.max)
        : salePriceHtml(product.price);

    const brandLabel = product.brand
        ? `<p class="product-brand-label">${escapeHtml(product.brand)}</p>`
        : '';

    return `
        <article class="product-card${fullSize ? ' full-size' : ''}" data-product-id="${product.id}">
            <a href="${productHref}" class="product-image-link">
                <div class="product-image">
                    ${SALE_ACTIVE ? `<span class="sale-badge">${SALE_LABEL}</span>` : ''}
                    ${imageHtml}
                    <button class="quick-view-btn" onclick="event.preventDefault(); event.stopPropagation(); openQuickView('${product.id}')">Quick View</button>
                </div>
            </a>
            <div class="product-info">
                ${brandLabel}
                <a href="${productHref}" class="product-name-link">
                    <h3 class="product-name">${escapeHtml(product.name)}</h3>
                </a>
                <p class="product-price">${priceHtml}</p>
                <div class="product-review-stars" data-review-id="${product.id}"></div>
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

function addToCart(productId, variationId, variationName, variationPrice) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const hasMultipleVariations = (Array.isArray(product.variations) && product.variations.length > 1) || !!product.priceRange;
    if (!variationId && hasMultipleVariations) {
        showToast('Select a size/variation first');
        setTimeout(() => {
            window.location.href = safeProductHref(product.id);
        }, 700);
        return;
    }

    // Use variation overrides if provided (from product detail page)
    const itemVariationId = variationId || product.variationId;
    const itemName = variationName || product.name;
    const itemPrice = variationPrice || product.price;

    // For variants, use a unique key combining product + variation
    const cartKey = variationId ? `${productId}_${variationId}` : productId;
    const existingItem = cart.find(item => (item.cartKey || item.id) === cartKey);

    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({
            id: product.id,
            cartKey: cartKey,
            variationId: itemVariationId,
            name: itemName,
            price: salePrice(itemPrice),
            originalPrice: Math.round(itemPrice),
            imageUrl: product.imageUrl,
            quantity: 1
        });
    }

    saveCart();
    updateCartUI();
    showToast('Added to cart!');
}

function removeFromCart(cartKey) {
    cart = cart.filter(item => (item.cartKey || item.id) !== cartKey);
    saveCart();
    updateCartUI();
}

function updateQuantity(cartKey, delta) {
    const item = cart.find(item => (item.cartKey || item.id) === cartKey);
    if (!item) return;
    item.quantity = Math.max(0, Math.round(item.quantity + delta));
    if (item.quantity <= 0) {
        removeFromCart(cartKey);
    } else {
        saveCart();
        updateCartUI();
    }
}

function saveCart() {
    localStorage.setItem('grasshopper-cart', JSON.stringify(cart));
}

const FREE_SHIPPING_THRESHOLD = 75;

function updateCartUI() {
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    const cartShipping = document.getElementById('cartShipping');
    const cartCount = document.querySelector('.cart-count');
    const checkoutBtn = document.getElementById('checkoutBtn');
    const pickupCheckBtn = document.getElementById('pickupCheckBtn');
    const shippingProgress = document.getElementById('shippingProgressBar');

    if (!cartItems) return;

    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (cartCount) {
        const prevCount = parseInt(cartCount.textContent, 10) || 0;
        cartCount.textContent = totalItems;
        cartCount.classList.toggle('visible', totalItems > 0);
        if (totalItems > prevCount) {
            cartCount.classList.remove('bump');
            void cartCount.offsetWidth;
            cartCount.classList.add('bump');
        }
    }

    if (cartShipping) cartShipping.textContent = totalItems > 0 ? 'Calculated at checkout' : '$0.00';
    if (cartTotal) cartTotal.textContent = `$${Math.round(subtotal)}`;
    if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
    if (pickupCheckBtn) pickupCheckBtn.style.display = cart.length === 0 ? 'none' : '';

    // Free shipping progress bar
    if (shippingProgress) {
        if (cart.length === 0) {
            shippingProgress.style.display = 'none';
        } else {
            shippingProgress.style.display = '';
            const pct = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);
            const remaining = FREE_SHIPPING_THRESHOLD - subtotal;
            const textEl = shippingProgress.querySelector('.shipping-progress-text');
            const fillEl = shippingProgress.querySelector('.shipping-progress-fill');
            if (remaining > 0) {
                textEl.className = 'shipping-progress-text';
                textEl.innerHTML = `<strong>$${Math.ceil(remaining)}</strong> away from free shipping`;
                fillEl.className = 'shipping-progress-fill';
                fillEl.style.width = `${pct}%`;
            } else {
                textEl.className = 'shipping-progress-text earned';
                textEl.innerHTML = '🎉 You qualify for <strong>free shipping!</strong>';
                fillEl.className = 'shipping-progress-fill complete';
                fillEl.style.width = '100%';
                // Celebrate on first qualify
                if (!shippingProgress.dataset.celebrated) {
                    shippingProgress.dataset.celebrated = 'true';
                    shippingProgress.classList.add('shipping-progress-celebrate');
                    setTimeout(() => shippingProgress.classList.remove('shipping-progress-celebrate'), 500);
                }
            }
            // Reset celebrated if dropped below
            if (remaining > 0) shippingProgress.dataset.celebrated = '';
        }
    }

    if (cart.length === 0) {
        cartItems.innerHTML = `
            <div class="cart-empty-state">
                <div class="cart-empty-icon">🛍</div>
                <h3 class="cart-empty-title">Your cart is empty</h3>
                <p class="cart-empty-text">Browse our collection and find something you'll love.</p>
                <a href="shop.html" class="cart-empty-cta" onclick="closeCart()">Shop Now</a>
            </div>
        `;
        return;
    }

    cartItems.innerHTML = cart.map(item => `
        <div class="cart-item">
            <a href="${safeProductHref(item.id)}" class="cart-item-image" style="cursor:pointer;">
                ${item.imageUrl ? `<img src="${escapeAttr(safeImageUrl(item.imageUrl))}" alt="${escapeAttr(item.name)}">` : ''}
            </a>
            <div class="cart-item-details">
                <a href="${safeProductHref(item.id)}" class="cart-item-name" style="text-decoration:none;color:inherit;cursor:pointer;">${escapeHtml(item.name)}</a>
                <p class="cart-item-price">${item.originalPrice && SALE_ACTIVE ? salePriceHtml(item.originalPrice) : `$${Math.round(item.price)}`}</p>
                <div class="cart-item-actions">
                    <button class="quantity-btn" onclick="updateQuantity('${item.cartKey || item.id}', -1)">−</button>
                    <span class="cart-item-quantity">${item.quantity}</span>
                    <button class="quantity-btn" onclick="updateQuantity('${item.cartKey || item.id}', 1)">+</button>
                    <button class="cart-item-remove" onclick="removeFromCart('${item.cartKey || item.id}')">Remove</button>
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

let searchDebounceTimer = null;
async function handleSearch(event) {
    event.preventDefault();
    const query = document.getElementById('searchInput').value.trim();
    const resultsContainer = document.getElementById('searchResults');
    if (!query) return;

    // Debounce: cancel pending timer and set a new one
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => executeSearch(query, resultsContainer), 300);
}

async function executeSearch(query, resultsContainer) {
    resultsContainer.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    try {
        const results = await searchProducts(query);
        if (results.length === 0) {
            resultsContainer.innerHTML = '<p class="search-no-results">No products found</p>';
            return;
        }

        resultsContainer.innerHTML = results.map(product => `
            <a class="search-result-item" href="${safeProductHref(product.id)}">
                <div class="search-result-image">
                    ${product.imageUrl ? `<img src="${escapeAttr(safeImageUrl(product.imageUrl))}" alt="${escapeAttr(product.name)}">` : ''}
                </div>
                <div class="search-result-info">
                    <p class="search-result-name">${escapeHtml(product.name)}</p>
                    <p class="search-result-price">${salePriceHtml(product.price)}</p>
                </div>
            </a>
        `).join('');

        allProducts = [...new Map([...allProducts, ...results].map(p => [p.id, p])).values()];
    } catch (error) {
        if (error.name === 'AbortError') return; // Request was superseded
        resultsContainer.innerHTML = '<p class="search-no-results">Search failed. Please try again.</p>';
    }
}

function goToProduct(productId) {
    closeSearch();
    window.location.href = `product.html?id=${productId}`;
}

// ============================================
// Quick View Modal
// ============================================

function openQuickView(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    let overlay = document.getElementById('quickviewOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'quickviewOverlay';
        overlay.className = 'quickview-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeQuickView();
        });
        overlay.innerHTML = `
            <div class="quickview-modal">
                <button class="quickview-close" onclick="closeQuickView()">&times;</button>
                <div class="quickview-image" id="qvImage"></div>
                <div class="quickview-details" id="qvDetails"></div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    const imageUrl = safeImageUrl(product.imageUrl);
    document.getElementById('qvImage').innerHTML = imageUrl
        ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(product.name)}">`
        : '<div class="product-image-placeholder">No Image</div>';

    const hasVariants = product.variations && product.variations.length > 1;
    const priceHtml = product.priceRange
        ? salePriceRangeHtml(product.priceRange.min, product.priceRange.max)
        : salePriceHtml(product.price);

    const variantHtml = hasVariants ? `
        <div class="quickview-variants">
            <label for="qvVariantSelect">Size / Option</label>
            <select id="qvVariantSelect" onchange="updateQuickViewPrice()">
                ${product.variations.map(v => `<option value="${v.id}" data-price="${v.price}">${escapeHtml(v.name)} — $${salePrice(v.price)}</option>`).join('')}
            </select>
        </div>
    ` : '';

    document.getElementById('qvDetails').innerHTML = `
        <p class="quickview-brand">${escapeHtml(product.brand || '')}</p>
        <h2 class="quickview-name">${escapeHtml(product.name)}</h2>
        <p class="quickview-price" id="qvPrice">${priceHtml}</p>
        ${variantHtml}
        <div class="quickview-actions">
            <button class="quickview-add-btn" onclick="quickViewAddToCart('${product.id}')">Add to Cart</button>
            <a href="${safeProductHref(product.id)}" class="quickview-view-btn">View Details</a>
        </div>
    `;

    overlay.dataset.productId = productId;
    requestAnimationFrame(() => overlay.classList.add('active'));
    document.body.style.overflow = 'hidden';
}

function closeQuickView() {
    const overlay = document.getElementById('quickviewOverlay');
    if (overlay) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function updateQuickViewPrice() {
    const select = document.getElementById('qvVariantSelect');
    if (!select) return;
    const price = parseFloat(select.options[select.selectedIndex]?.dataset.price || 0);
    const priceEl = document.getElementById('qvPrice');
    if (priceEl) priceEl.innerHTML = salePriceHtml(price);
}

function quickViewAddToCart(productId) {
    const select = document.getElementById('qvVariantSelect');
    if (select) {
        const option = select.options[select.selectedIndex];
        const product = allProducts.find(p => p.id === productId);
        if (product) {
            const variation = product.variations?.find(v => v.id === option.value);
            addToCart(productId, option.value, variation?.name, parseFloat(option.dataset.price));
        }
    } else {
        addToCart(productId);
    }
    closeQuickView();
    openCart();
}

// ============================================
// Toast Notification
// ============================================

function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('visible'), 2500);
}

// ============================================
// Mobile Menu
// ============================================

function openMobileMenu() {
    const menu = document.querySelector('.mobile-menu');
    const overlay = document.querySelector('.mobile-menu-overlay');
    const btn = document.querySelector('.nav-hamburger');
    menu?.classList.add('active');
    overlay?.classList.add('active');
    btn?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
    const menu = document.querySelector('.mobile-menu');
    const overlay = document.querySelector('.mobile-menu-overlay');
    const btn = document.querySelector('.nav-hamburger');
    menu?.classList.remove('active');
    overlay?.classList.remove('active');
    btn?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
}


// ============================================
// Back to Top
// ============================================

function initBackToTop() {
    const btn = document.getElementById('backToTop');
    if (!btn) return;
    window.addEventListener('scroll', () => {
        btn.classList.toggle('visible', window.scrollY > 400);
    });
}

// ============================================
// Event Listeners
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Inject sale banner
    if (SALE_ACTIVE) {
        const banner = document.createElement('div');
        banner.className = 'sale-banner';
        banner.innerHTML = `<a href="shop.html">${SALE_BANNER_TEXT}</a>`;
        document.body.prepend(banner);
        document.body.classList.add('has-sale-banner');
    }

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

    // Mobile menu
    const navHamburger = document.querySelector('.nav-hamburger');
    if (navHamburger) {
        navHamburger.setAttribute('aria-expanded', 'false');
        navHamburger.addEventListener('click', openMobileMenu);
    }
    document.querySelector('.mobile-menu-close')?.addEventListener('click', closeMobileMenu);
    document.querySelector('.mobile-menu-overlay')?.addEventListener('click', closeMobileMenu);

    // Back to top
    initBackToTop();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeCart(); closeSearch(); closeMobileMenu(); }
    });

    // Scroll-reveal observer for [data-reveal] elements
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('[data-reveal]').forEach((el, i) => {
        const delay = el.dataset.revealDelay;
        if (delay) el.style.setProperty('--reveal-delay', delay);
        revealObserver.observe(el);
    });
});

// Review stars on product cards
const reviewCache = {};
let reviewsLoading = false;

async function loadCardReviews() {
    if (reviewsLoading) return;
    reviewsLoading = true;

    const cards = document.querySelectorAll('.product-review-stars[data-review-id]:not([data-loaded])');
    const ids = [...new Set([...cards].map(c => c.dataset.reviewId))];

    for (const id of ids) {
        if (reviewCache[id] !== undefined) {
            applyReviewStars(id, reviewCache[id]);
            continue;
        }
        try {
            const res = await fetch(`/api/reviews?productId=${encodeURIComponent(id)}`);
            const reviews = await res.json();
            reviewCache[id] = reviews;
            applyReviewStars(id, reviewCache[id]);
        } catch (e) {
            reviewCache[id] = [];
            applyReviewStars(id, []);
        }
    }
    reviewsLoading = false;
}

function applyReviewStars(productId, reviews) {
    document.querySelectorAll(`.product-review-stars[data-review-id="${productId}"]`).forEach(el => {
        el.setAttribute('data-loaded', 'true');
        if (reviews.length === 0) {
            let stars = '';
            for (let i = 0; i < 5; i++) stars += '<span class="star star-empty">★</span>';
            el.innerHTML = `${stars}<span class="card-review-count">(0)</span>`;
            return;
        }
        const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
        let stars = '';
        for (let i = 1; i <= 5; i++) {
            stars += `<span class="star ${i <= Math.round(avg) ? 'star-filled' : 'star-empty'}">★</span>`;
        }
        el.innerHTML = `${stars}<span class="card-review-count">(${reviews.length})</span>`;
    });
}

// Auto-load reviews after grids render, debounced
let reviewTimer = null;
const cardObserver = new MutationObserver(() => {
    if (document.querySelector('.product-review-stars[data-review-id]:not([data-loaded])')) {
        clearTimeout(reviewTimer);
        reviewTimer = setTimeout(loadCardReviews, 300);
    }
});
cardObserver.observe(document.body, { childList: true, subtree: true });
