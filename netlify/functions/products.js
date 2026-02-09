const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';

// Log to help debug
console.log('Token exists:', !!SQUARE_ACCESS_TOKEN);

const brandPatterns = [
    // Women's brands
    { pattern: /^b&b\s|^bumble/i, brand: 'Bumble and Bumble' },
    { pattern: /^olaplex/i, brand: 'Olaplex' },
    { pattern: /^ouai/i, brand: 'OUAI' },
    { pattern: /^living proof/i, brand: 'Living Proof' },
    { pattern: /^cw\s/i, brand: 'Color Wow' },
    // Men's brands
    { pattern: /^redken brews/i, brand: 'Redken Brews' },
    { pattern: /^american crew/i, brand: 'American Crew' },
    { pattern: /^18\.21\s*man\s*made/i, brand: '18.21 Man Made' },
    { pattern: /^pete\s*&\s*pedro/i, brand: 'Pete & Pedro' },
    { pattern: /^big sexy hair|^sexy hair style/i, brand: 'Sexy Hair' },
    { pattern: /^l3vel3/i, brand: 'L3VEL3' },
    { pattern: /^the good sh[*i]t/i, brand: 'The Good Sh*t' },
];

const mensBrands = new Set([
    'Redken Brews', 'American Crew', '18.21 Man Made',
    'Pete & Pedro', 'Sexy Hair', 'L3VEL3', 'The Good Sh*t'
]);

function extractBrand(name) {
    for (const { pattern, brand } of brandPatterns) {
        if (pattern.test(name)) {
            return brand;
        }
    }
    return 'Color Wow';
}

async function fetchAllCatalogObjects(type) {
    const objects = [];
    let cursor = null;

    do {
        const url = new URL(`${SQUARE_BASE_URL}/catalog/list`);
        url.searchParams.append('types', type);
        if (cursor) url.searchParams.append('cursor', cursor);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Square-Version': '2024-01-18',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Square API Error (${type}):`, response.status, errorText);
            throw new Error(`Square API returned ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        if (data.objects) objects.push(...data.objects);
        cursor = data.cursor;
    } while (cursor);

    return objects;
}

async function fetchAllImages() {
    const imageObjects = await fetchAllCatalogObjects('IMAGE');
    const images = {};
    imageObjects.forEach(img => {
        if (img.image_data?.url) {
            images[img.id] = img.image_data.url;
        }
    });
    return images;
}

async function fetchCategories() {
    const categoryObjects = await fetchAllCatalogObjects('CATEGORY');
    const categories = {};
    categoryObjects.forEach(cat => {
        if (cat.category_data?.name) {
            categories[cat.id] = cat.category_data.name;
        }
    });
    return categories;
}

exports.handler = async (event) => {
    console.log('Products function called');

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (!SQUARE_ACCESS_TOKEN) {
        console.error('SQUARE_ACCESS_TOKEN environment variable is not set');
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Missing Square API token - check Netlify environment variables' })
        };
    }

    console.log('Square token exists, fetching products...');

    try {
        let allItems = [];
        let cursor = null;

        do {
            const url = new URL(`${SQUARE_BASE_URL}/catalog/list`);
            url.searchParams.append('types', 'ITEM');
            if (cursor) url.searchParams.append('cursor', cursor);

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Square-Version': '2024-01-18',
                    'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Square API Error:', response.status, errorText);
                throw new Error(`Square API returned ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            if (data.objects) allItems = allItems.concat(data.objects);
            cursor = data.cursor;
        } while (cursor);

        const [images, categories] = await Promise.all([fetchAllImages(), fetchCategories()]);

        const products = allItems
            .map(item => {
                const itemData = item.item_data;
                let imageUrl = null;

                if (itemData.image_ids?.length > 0) {
                    imageUrl = images[itemData.image_ids[0]];
                }

                // Calculate price range for products with multiple variations
                let minPrice = 0;
                let maxPrice = 0;
                let variationId = null;

                if (itemData.variations?.length > 0) {
                    const prices = itemData.variations
                        .filter(v => v.item_variation_data?.price_money)
                        .map(v => v.item_variation_data.price_money.amount / 100);

                    if (prices.length > 0) {
                        minPrice = Math.min(...prices);
                        maxPrice = Math.max(...prices);
                    }

                    variationId = itemData.variations[0].id;
                }

                // Resolve category name from category_id
                let category = null;
                if (itemData.category_id) {
                    category = categories[itemData.category_id] || null;
                }

                const brand = extractBrand(itemData.name || '');

                // Auto-assign men's category if brand is a men's brand
                if (!category && mensBrands.has(brand)) {
                    category = 'Mens Products';
                }

                return {
                    id: item.id,
                    variationId,
                    name: itemData.name || '',
                    description: itemData.description || '',
                    price: minPrice,
                    priceRange: minPrice !== maxPrice ? { min: minPrice, max: maxPrice } : null,
                    imageUrl,
                    brand,
                    category,
                    productType: itemData.product_type
                };
            })
            .filter(product => {
                if (product.productType === 'APPOINTMENTS_SERVICE') return false;
                return true;
            });

        console.log(`Successfully fetched ${products.length} products`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(products)
        };
    } catch (error) {
        console.error('Error fetching products:', error.message, error.stack);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: error.message || 'Failed to fetch products from Square API'
            })
        };
    }
};
