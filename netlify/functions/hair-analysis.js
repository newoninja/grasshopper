const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';

const brandPatterns = [
    { pattern: /^b&b\s|^bumble/i, brand: 'Bumble and Bumble' },
    { pattern: /^olaplex/i, brand: 'Olaplex' },
    { pattern: /^ouai/i, brand: 'OUAI' },
    { pattern: /^living proof/i, brand: 'Living Proof' },
    { pattern: /^cw\s/i, brand: 'Color Wow' },
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
        if (!response.ok) throw new Error(`Square API returned ${response.status}`);
        const data = await response.json();
        if (data.objects) objects.push(...data.objects);
        cursor = data.cursor;
    } while (cursor);
    return objects;
}

async function fetchAllProducts() {
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
        if (!response.ok) throw new Error(`Square API returned ${response.status}`);
        const data = await response.json();
        if (data.objects) allItems = allItems.concat(data.objects);
        cursor = data.cursor;
    } while (cursor);

    const imageObjects = await fetchAllCatalogObjects('IMAGE');
    const images = {};
    imageObjects.forEach(img => {
        if (img.image_data?.url) images[img.id] = img.image_data.url;
    });

    const categoryObjects = await fetchAllCatalogObjects('CATEGORY');
    const categories = {};
    categoryObjects.forEach(cat => {
        if (cat.category_data?.name) categories[cat.id] = cat.category_data.name;
    });

    return allItems
        .map(item => {
            const itemData = item.item_data;
            let imageUrl = null;
            if (itemData.image_ids?.length > 0) imageUrl = images[itemData.image_ids[0]];

            let minPrice = 0, maxPrice = 0, variationId = null;
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

            let category = null;
            if (itemData.category_id) category = categories[itemData.category_id] || null;

            const brand = extractBrand(itemData.name || '');
            if (!category && mensBrands.has(brand)) category = 'Mens Products';

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
        .filter(p => p.productType !== 'APPOINTMENTS_SERVICE');
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

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    if (!ANTHROPIC_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI service not configured' }) };
    }

    if (!SQUARE_ACCESS_TOKEN) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Product service not configured' }) };
    }

    try {
        const { image, mensMode } = JSON.parse(event.body || '{}');

        if (!image) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'No image provided' }) };
        }

        // Fetch all products from Square
        const products = await fetchAllProducts();

        // Filter by mode
        const relevantProducts = mensMode
            ? products.filter(p => p.category === 'Mens Products')
            : products.filter(p => p.category !== 'Mens Products');

        // Build product catalog for Claude
        const catalog = relevantProducts.map(p => ({
            id: p.id,
            name: p.name,
            brand: p.brand,
            description: p.description,
            price: p.price,
            category: p.category
        }));

        const systemPrompt = `You are D'yette Spain, an expert hair stylist with 32 years of professional experience in Charlotte, NC. You trained at Vidal Sassoon Academy in London and hold Redken's hair color certification. You've worked backstage with Redken for over ten years.

You are analyzing a photo of someone's hair to provide a warm, encouraging professional assessment and personalized product recommendations from your curated shop inventory.

TONE & VOICE — THIS IS CRITICAL:
- Be warm, positive, and uplifting. You are talking to a potential customer, not writing a clinical report.
- NEVER use words like "greasy", "oily", "dry", "damaged", "frizzy", "thin", or "limp" in a negative or blunt way. Instead, reframe positively:
  - Instead of "your hair is oily/greasy" → "your hair has great natural shine — a lightweight product would help you get even more body and bounce"
  - Instead of "your hair is dry/damaged" → "your hair could use a little extra love and hydration to really bring out its full potential"
  - Instead of "your hair is frizzy" → "you've got beautiful texture — the right product will help define it even more"
  - Instead of "your hair looks thin" → "you have a lovely fine texture — a volumizing product would give you that extra fullness"
- Lead with compliments. Find something genuinely nice to say about their hair first.
- Frame every recommendation as an upgrade or enhancement, not a fix for a problem. You're helping them level up, not pointing out flaws.
- Speak like a friendly stylist chatting with a client in the salon chair — approachable, encouraging, and excited to help them look their best.

ANALYSIS INSTRUCTIONS:
1. Hair Type: Identify as straight (Type 1), wavy (Type 2), curly (Type 3), or coily (Type 4). Note subtypes (A/B/C) and density (thin, medium, thick). Frame positively.
2. Hair Color: Identify natural color, any color treatments (dyed, bleached, highlighted, balayage), root status, and tone (warm, cool, neutral). Compliment their color choices.
3. Condition: Gently note where their hair could benefit from extra care. Focus on the OPPORTUNITY to enhance, not the current shortcoming. Never be harsh or condescending.
4. Texture: Identify as fine, medium, or coarse. Note porosity if visible (low, normal, high). Celebrate their natural texture.

PRODUCT RECOMMENDATION INSTRUCTIONS:
- Select 3-5 products from the catalog below that best enhance this person's hair
- Each recommendation must include the exact product ID and a personalized, enthusiastic reason explaining how this product will elevate their look
- Frame recommendations as exciting upgrades: "this would be amazing for you" not "you need this because your hair has problems"
- Consider the person's hair type and texture when recommending — not all products work for all types

PRODUCT CATALOG:
${JSON.stringify(catalog, null, 2)}

RESPONSE FORMAT — respond with valid JSON only, no markdown:
{
  "analysis": {
    "hairType": "description of hair type and density",
    "hairColor": "description of color, treatments, and tone",
    "condition": "assessment of moisture, damage, and specific concerns",
    "texture": "fine/medium/coarse and porosity"
  },
  "recommendedProductIds": [
    {
      "id": "product_id_here",
      "reason": "Personalized explanation of why this product helps their specific hair"
    }
  ]
}`;

        // Extract the base64 data (remove data URL prefix if present)
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

        // Detect media type
        let mediaType = 'image/jpeg';
        if (image.startsWith('data:image/png')) mediaType = 'image/png';
        else if (image.startsWith('data:image/webp')) mediaType = 'image/webp';
        else if (image.startsWith('data:image/gif')) mediaType = 'image/gif';

        // Call Claude API
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 1500,
                system: systemPrompt,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Data
                            }
                        },
                        {
                            type: 'text',
                            text: 'Please analyze this hair photo and recommend products from the catalog.'
                        }
                    ]
                }]
            })
        });

        if (!claudeResponse.ok) {
            const errorText = await claudeResponse.text();
            console.error('Claude API error:', claudeResponse.status, errorText);
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: 'AI analysis failed. Please try again.' })
            };
        }

        const claudeData = await claudeResponse.json();
        const responseText = claudeData.content?.[0]?.text || '';

        // Parse Claude's JSON response
        let analysisResult;
        try {
            // Try to extract JSON from the response (handle potential markdown wrapping)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found in response');
            analysisResult = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
            console.error('Failed to parse Claude response:', responseText);
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: 'Failed to parse AI analysis. Please try again.' })
            };
        }

        // Match recommended product IDs to full product data
        const recommendations = (analysisResult.recommendedProductIds || [])
            .map(rec => {
                const product = relevantProducts.find(p => p.id === rec.id);
                if (!product) return null;
                return {
                    product,
                    reason: rec.reason
                };
            })
            .filter(Boolean);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                analysis: analysisResult.analysis,
                recommendations
            })
        };
    } catch (error) {
        console.error('Hair analysis error:', error.message, error.stack);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Something went wrong. Please try again.' })
        };
    }
};
