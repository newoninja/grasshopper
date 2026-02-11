const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const { fetchSquareJson, listCatalogObjectsByType } = require('./square-utils');
const { buildCorsHeaders, jsonResponse, methodNotAllowed } = require('./request-utils');

const brandPatterns = [
    // Women's brands
    { pattern: /^b&b\s|^bumble/i, brand: 'Bumble and Bumble' },
    { pattern: /^olaplex/i, brand: 'Olaplex' },
    { pattern: /^ouai/i, brand: 'OUAI' },
    { pattern: /^living proof/i, brand: 'Living Proof' },
    { pattern: /^cw\s/i, brand: 'Color Wow' },
    { pattern: /^the doux/i, brand: 'The Doux' },
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
    const imageObjects = await listCatalogObjectsByType(SQUARE_ACCESS_TOKEN, 'IMAGE');
    imageObjects.forEach((img) => {
        if (img.image_data?.url) images[img.id] = img.image_data.url;
    });

    return images;
}

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';

exports.handler = async (event) => {
    const headers = buildCorsHeaders(SITE_ORIGIN);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return methodNotAllowed(headers);
    }

    if (!SQUARE_ACCESS_TOKEN) {
        return jsonResponse(500, headers, { error: 'Product service not configured' });
    }

    try {
        const query = event.queryStringParameters?.q || '';
        const searchResponse = await fetchSquareJson(SQUARE_ACCESS_TOKEN, '/catalog/search', {
            method: 'POST',
            body: {
                object_types: ['ITEM'],
                query: { text_query: { keywords: [query] } }
            }
        });
        if (!searchResponse.ok) {
            return jsonResponse(502, headers, { error: 'Failed to search catalog' });
        }

        const data = searchResponse.data;
        const images = await fetchAllImages();

        // Fetch categories for category mapping
        const categories = {};
        try {
            const categoryObjects = await listCatalogObjectsByType(SQUARE_ACCESS_TOKEN, 'CATEGORY');
            categoryObjects.forEach((cat) => {
                if (cat.category_data?.name) categories[cat.id] = cat.category_data.name;
            });
        } catch (e) {
            console.error('Error fetching categories:', e);
        }

        const products = (data.objects || [])
            .map(item => {
                const itemData = item.item_data;
                let imageUrl = null;

                if (itemData.image_ids?.length > 0) {
                    imageUrl = images[itemData.image_ids[0]];
                }

                let price = 0;
                let variationId = null;
                if (itemData.variations?.length > 0) {
                    const variation = itemData.variations[0];
                    variationId = variation.id;
                    if (variation.item_variation_data?.price_money) {
                        price = variation.item_variation_data.price_money.amount / 100;
                    }
                }

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
                    price,
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

        return jsonResponse(200, headers, products);
    } catch (error) {
        console.error('Error:', error);
        return jsonResponse(500, headers, { error: 'Failed to search' });
    }
};
