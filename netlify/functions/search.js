const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';

const brandPatterns = [
    { pattern: /^b&b\s|^bumble/i, brand: 'Bumble and Bumble' },
    { pattern: /^olaplex/i, brand: 'Olaplex' },
    { pattern: /^ouai/i, brand: 'OUAI' },
    { pattern: /^living proof/i, brand: 'Living Proof' },
    { pattern: /^cw\s/i, brand: 'Color Wow' },
];

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
        const query = event.queryStringParameters?.q || '';

        const response = await fetch(`${SQUARE_BASE_URL}/catalog/search`, {
            method: 'POST',
            headers: {
                'Square-Version': '2024-01-18',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                object_types: ['ITEM'],
                query: { text_query: { keywords: [query] } }
            })
        });

        const data = await response.json();
        const images = await fetchAllImages();

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

                return {
                    id: item.id,
                    variationId,
                    name: itemData.name || '',
                    description: itemData.description || '',
                    price,
                    imageUrl,
                    brand: extractBrand(itemData.name || ''),
                    productType: itemData.product_type
                };
            })
            .filter(product => {
                if (product.productType === 'APPOINTMENTS_SERVICE') return false;
                if (!product.imageUrl) return false;
                return true;
            });

        return { statusCode: 200, headers, body: JSON.stringify(products) };
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to search' }) };
    }
};
