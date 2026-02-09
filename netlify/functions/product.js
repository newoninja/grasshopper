const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';

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
        if (pattern.test(name)) return brand;
    }
    return 'Color Wow';
}

async function fetchAllImages() {
    const images = {};
    let cursor = null;

    do {
        const url = new URL(`${SQUARE_BASE_URL}/catalog/list`);
        url.searchParams.append('types', 'IMAGE');
        if (cursor) url.searchParams.append('cursor', cursor);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Square-Version': '2024-01-18',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (data.objects) {
            data.objects.forEach(img => {
                if (img.image_data?.url) images[img.id] = img.image_data.url;
            });
        }
        cursor = data.cursor;
    } while (cursor);

    return images;
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const productId = event.queryStringParameters?.id;

        if (!productId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product ID required' }) };
        }

        const response = await fetch(`${SQUARE_BASE_URL}/catalog/object/${productId}`, {
            method: 'GET',
            headers: {
                'Square-Version': '2024-01-18',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!data.object) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Product not found' }) };
        }

        const item = data.object;
        const itemData = item.item_data;
        const images = await fetchAllImages();

        // Resolve category
        let category = null;
        if (itemData.category_id) {
            try {
                const catResponse = await fetch(`${SQUARE_BASE_URL}/catalog/object/${itemData.category_id}`, {
                    method: 'GET',
                    headers: {
                        'Square-Version': '2024-01-18',
                        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                });
                const catData = await catResponse.json();
                if (catData.object?.category_data?.name) {
                    category = catData.object.category_data.name;
                }
            } catch (e) {
                console.error('Error fetching category:', e);
            }
        }

        let imageUrl = null;
        if (itemData.image_ids?.length > 0) {
            imageUrl = images[itemData.image_ids[0]];
        }

        // Get all variations with their prices and names
        const variations = [];
        if (itemData.variations?.length > 0) {
            itemData.variations.forEach(variation => {
                const varData = variation.item_variation_data;
                if (varData) {
                    variations.push({
                        id: variation.id,
                        name: varData.name || 'Standard',
                        price: varData.price_money ? varData.price_money.amount / 100 : 0,
                        sku: varData.sku || ''
                    });
                }
            });
        }

        // Get price range or single price
        let minPrice = 0;
        let maxPrice = 0;
        if (variations.length > 0) {
            const prices = variations.map(v => v.price);
            minPrice = Math.min(...prices);
            maxPrice = Math.max(...prices);
        }

        const brand = extractBrand(itemData.name || '');

        // Auto-assign men's category if brand is a men's brand
        if (!category && mensBrands.has(brand)) {
            category = 'Mens Products';
        }

        const product = {
            id: item.id,
            variationId: variations[0]?.id || null,
            name: itemData.name || '',
            description: itemData.description || '',
            price: minPrice,
            priceRange: minPrice !== maxPrice ? { min: minPrice, max: maxPrice } : null,
            variations,
            imageUrl,
            brand,
            category
        };

        return { statusCode: 200, headers, body: JSON.stringify(product) };
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch product' }) };
    }
};
