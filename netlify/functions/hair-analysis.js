const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';

const brandPatterns = [
    { pattern: /^b&b\s|^bumble/i, brand: 'Bumble and Bumble' },
    { pattern: /^olaplex/i, brand: 'Olaplex' },
    { pattern: /^ouai/i, brand: 'OUAI' },
    { pattern: /^living proof/i, brand: 'Living Proof' },
    { pattern: /^cw\s/i, brand: 'Color Wow' },
    { pattern: /^doux\b/i, brand: 'The Doux' },
    { pattern: /^the doux/i, brand: 'The Doux' },
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

function isDouxProduct(product) {
    return product.brand === 'The Doux' ||
        /\bdoux\b/i.test(product.name || '') ||
        /\bdoux\b/i.test(product.description || '');
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
        const { image, mensMode, douxFocus } = JSON.parse(event.body || '{}');

        if (!image) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'No image provided' }) };
        }

        // Fetch all products from Square
        const products = await fetchAllProducts();

        // Filter by mode
        let relevantProducts = mensMode
            ? products.filter(p => p.category === 'Mens Products')
            : products.filter(p => p.category !== 'Mens Products');

        // Optional user-selected The Doux focus (no ethnicity inference).
        if (douxFocus && !mensMode) {
            const douxOnly = relevantProducts.filter(isDouxProduct);
            if (douxOnly.length > 0) relevantProducts = douxOnly;
        }

        const douxInstruction = (douxFocus && !mensMode)
            ? '\n- The customer selected The Doux focus. Recommend only The Doux products from the catalog and prioritize a complete routine (cleanse + treat + style).'
            : '';

        // Build product catalog for Claude
        const catalog = relevantProducts.map(p => ({
            id: p.id,
            name: p.name,
            brand: p.brand,
            description: (p.description || '').replace(/\s+/g, ' ').trim().slice(0, 240),
            price: p.price,
            category: p.category
        }));

        const systemPrompt = `You are D'yette Spain, an expert hair stylist with 32 years of professional experience in Charlotte, NC. You trained at Vidal Sassoon Academy in London, hold Redken color certification, and worked backstage with Redken for over ten years.

You are analyzing a photo of someone's hair and recommending products from your curated shop inventory.

PRIMARY GOAL:
- Give a warm, confidence-building professional assessment.
- Convert that confidence into clear purchase intent with recommendations that feel exciting, specific, and worth adding to cart today.

TONE & VOICE (CRITICAL):
- Warm, uplifting, friendly stylist voice. Never clinical or harsh.
- Lead with at least one genuine compliment.
- Never shame the customer or describe them negatively.
- Use concern words only in soft, supportive framing, e.g. "could benefit from extra hydration" not "your hair is damaged."
- Frame products as upgrades that unlock better results, not fixes for "bad" hair.

ANALYSIS INSTRUCTIONS:
1) Hair Type: Identify straight (Type 1), wavy (Type 2), curly (Type 3), or coily (Type 4), with subtype when visible and density (fine/medium/thick) in positive wording.
2) Hair Color: Be highly specific. Distinguish black/dark brown/medium brown/light brown/blonde/red/copper/auburn/orange/fashion shades. If color looks warm, call out warm terms directly (copper, orange, golden, red-orange) rather than defaulting to brown. Note roots vs mids/ends and natural vs color-treated traits when visible.
3) Condition: Note where extra care would improve results, using encouraging language and no blunt negatives.
4) Texture: Identify fine/medium/coarse and porosity if visible; celebrate natural texture.

PRODUCT RECOMMENDATION INSTRUCTIONS (SELLING WITH SERVICE):
- Select 3-5 products from the catalog below that best match this person's hair and goals.
- Use exact product IDs from the catalog.
- Recommendation reasons must be personalized and conversion-focused:
  - Mention a specific visible outcome (shine, softness, definition, volume, smoothness, color longevity, scalp comfort, hold, etc.).
  - Include a usage cue (when/how they would use it) so it feels easy to start.
  - End with a gentle buy-action hook (e.g., "great add-to-cart pick to start seeing results this week").
- Keep reasons concise (1-2 sentences each), energetic, and not repetitive.
- Recommend a balanced routine when possible (care + styling, not all from one function).
- Do not invent products or IDs.
- Never infer or mention ethnicity, race, or protected traits from the photo.
${douxInstruction}

STRICT OUTPUT RULES:
- Return valid JSON only, no markdown, no extra keys, no commentary outside JSON.
- If uncertain, make the best professional estimate from the photo and catalog.

PRODUCT CATALOG:
${JSON.stringify(catalog, null, 2)}

RESPONSE FORMAT:
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
                            text: 'Please analyze this hair photo with specific color naming and recommend 3-5 products with strong personalized buy-action reasons.'
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
                const rawReason = typeof rec.reason === 'string' ? rec.reason.trim() : '';
                const reason = rawReason || 'Great fit for your routine and a strong add-to-cart pick to start seeing results this week.';
                const hasBuyHook = /(add-to-cart|add to cart|start seeing results|this week|pick|shop|grab|routine)/i.test(reason);
                return {
                    product,
                    reason: hasBuyHook
                        ? reason
                        : `${reason} Great add-to-cart pick to start seeing results this week.`
                };
            })
            .filter(Boolean);

        // Guarantee The Doux output when user explicitly selected The Doux focus.
        if (douxFocus && !mensMode && recommendations.length === 0) {
            const fallbackDoux = relevantProducts
                .filter(isDouxProduct)
                .slice(0, 4)
                .map(product => ({
                    product,
                    reason: 'Strong match for your hair goals and a great add-to-cart pick to start seeing results this week.'
                }));
            recommendations.push(...fallbackDoux);
        }

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
