const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';

// Log to help debug
console.log('Token exists:', !!SQUARE_ACCESS_TOKEN);

const brandPatterns = [
    { pattern: /^b&b\s|^bumble/i, brand: 'Bumble and Bumble' },
    { pattern: /^olaplex/i, brand: 'Olaplex' },
    { pattern: /^ouai/i, brand: 'OUAI' },
    { pattern: /^living proof/i, brand: 'Living Proof' },
];

function extractBrand(name) {
    for (const { pattern, brand } of brandPatterns) {
        if (pattern.test(name)) {
            return brand;
        }
    }
    return 'Other';
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

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Square API Error (images):', response.status, errorText);
            throw new Error(`Square API returned ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        if (data.objects) {
            data.objects.forEach(img => {
                if (img.image_data?.url) {
                    images[img.id] = img.image_data.url;
                }
            });
        }
        cursor = data.cursor;
    } while (cursor);

    return images;
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

        const images = await fetchAllImages();

        const products = allItems
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
