const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const { listCatalogObjectsByType } = require('./square-utils');
const { buildCorsHeaders, jsonResponse, methodNotAllowed, parseJsonBody } = require('./request-utils');

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

function extractJsonObject(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
        return JSON.parse(jsonMatch[0]);
    } catch {
        return null;
    }
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function isGenericBrownColor(text) {
    return /\bbrown\b/i.test(text || '') &&
        !/(auburn|copper|orange|red|gold|golden|ginger|mahogany|caramel|chestnut|bronze)/i.test(text || '');
}

async function fetchAllProducts() {
    const allItems = await listCatalogObjectsByType(SQUARE_ACCESS_TOKEN, 'ITEM');
    const imageObjects = await listCatalogObjectsByType(SQUARE_ACCESS_TOKEN, 'IMAGE');
    const images = {};
    imageObjects.forEach(img => {
        if (img.image_data?.url) images[img.id] = img.image_data.url;
    });

    const categoryObjects = await listCatalogObjectsByType(SQUARE_ACCESS_TOKEN, 'CATEGORY');
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

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';

exports.handler = async (event) => {
    const headers = buildCorsHeaders(SITE_ORIGIN);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return methodNotAllowed(headers);
    }

    if (!ANTHROPIC_API_KEY) {
        return jsonResponse(500, headers, { error: 'AI service not configured' });
    }

    if (!SQUARE_ACCESS_TOKEN) {
        return jsonResponse(500, headers, { error: 'Product service not configured' });
    }

    const parsed = parseJsonBody(event, headers);
    if (!parsed.ok) return parsed.response;

    try {
        const { image, mensMode, douxFocus } = parsed.body;

        if (!image) {
            return jsonResponse(400, headers, { error: 'No image provided' });
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

        // Extract the base64 data (remove data URL prefix if present)
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

        // Detect media type
        let mediaType = 'image/jpeg';
        if (image.startsWith('data:image/png')) mediaType = 'image/png';
        else if (image.startsWith('data:image/webp')) mediaType = 'image/webp';
        else if (image.startsWith('data:image/gif')) mediaType = 'image/gif';

        async function callClaude({ system, userText, includeImage = true, maxTokens = 1200 }) {
            const content = [];
            if (includeImage) {
                content.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: mediaType,
                        data: base64Data
                    }
                });
            }
            content.push({ type: 'text', text: userText });

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-5-20250929',
                    max_tokens: maxTokens,
                    system,
                    messages: [{ role: 'user', content }]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Claude API returned ${response.status}: ${errorText}`);
            }
            const data = await response.json();
            return data.content?.[0]?.text || '';
        }

        // Stage 1: vision extraction for structured hair traits.
        const extractionPrompt = `You are a precise professional hair analysis assistant.

Analyze the provided hair photo and output ONLY valid JSON with this exact shape:
{
  "hairProfile": {
    "hairType": "short text",
    "hairColor": "highly specific color description",
    "colorFamily": "one of: black, brown, blonde, red, copper, auburn, orange, fashion",
    "tone": "warm, cool, or neutral",
    "condition": "short text",
    "texture": "short text"
  }
}

Rules:
- Be specific with color. Prefer copper/orange/auburn/red-orange when visible instead of defaulting to brown.
- Never infer race, ethnicity, or protected traits.
- No markdown or extra keys.`;

        let extractedProfile = {};
        try {
            const extractionText = await callClaude({
                system: extractionPrompt,
                userText: 'Extract structured hair traits from this photo.',
                includeImage: true,
                maxTokens: 500
            });
            const extractionJson = extractJsonObject(extractionText);
            extractedProfile = extractionJson?.hairProfile || {};
        } catch (stage1Error) {
            console.error('Hair extraction stage failed:', stage1Error.message);
        }

        const extractedSummary = JSON.stringify(extractedProfile, null, 2);
        const systemPrompt = `You are D'yette Spain, an expert hair stylist with 32 years of professional experience in Charlotte, NC. You trained at Vidal Sassoon Academy in London, hold Redken color certification, and worked backstage with Redken for over ten years.

You are creating a warm, conversion-focused hair assessment and product recommendation.

Use this extracted hair profile as your primary visual source of truth:
${extractedSummary}

PRIMARY GOAL:
- Give a warm, confidence-building professional assessment.
- Convert that confidence into clear purchase intent with recommendations worth adding to cart today.

TONE & VOICE (CRITICAL):
- Warm, uplifting, friendly stylist voice. Never clinical or harsh.
- Lead with at least one genuine compliment.
- Never shame the customer or describe them negatively.
- Use supportive phrasing for concerns.

ANALYSIS INSTRUCTIONS:
1) Hair Type: include visible curl pattern and density.
2) Hair Color: be highly specific (black/dark brown/medium brown/light brown/blonde/red/copper/auburn/orange/fashion). Prefer warm-specific labels like copper/orange/red-orange over plain brown when applicable.
3) Condition: mention improvement opportunities positively.
4) Texture: identify fine/medium/coarse and porosity cues when visible.

PRODUCT RECOMMENDATION INSTRUCTIONS (SELLING WITH SERVICE):
- Select 3-5 products from the catalog below that best match this person's hair and goals.
- Use exact product IDs from the catalog.
- Recommendation reasons must be personalized and conversion-focused:
  - Mention a specific visible outcome.
  - Include a usage cue (when/how to use).
  - End with a gentle buy-action hook.
- Keep reasons concise and non-repetitive.
- Recommend a balanced routine when possible.
- Do not invent products or IDs.
- Never infer or mention ethnicity, race, or protected traits.
${douxInstruction}

STRICT OUTPUT RULES:
- Return valid JSON only, no markdown, no extra keys, no commentary outside JSON.

PRODUCT CATALOG:
${JSON.stringify(catalog, null, 2)}

RESPONSE FORMAT:
{
  "analysis": {
    "hairType": "description of hair type and density",
    "hairColor": "description of color, treatments, and tone",
    "condition": "assessment of moisture/strength and care opportunities",
    "texture": "fine/medium/coarse and porosity cues"
  },
  "recommendedProductIds": [
    {
      "id": "product_id_here",
      "reason": "Personalized explanation with outcome + usage + buy hook"
    }
  ]
}`;

        let analysisResult;
        try {
            const stage2Text = await callClaude({
                system: systemPrompt,
                userText: 'Using the extracted profile and catalog, return the final analysis and recommendations.',
                includeImage: false,
                maxTokens: 1500
            });
            analysisResult = extractJsonObject(stage2Text);
            if (!analysisResult) throw new Error('No valid JSON in stage 2 response');
        } catch (stage2Error) {
            console.error('Hair recommendation stage failed:', stage2Error.message);
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: 'AI analysis failed. Please try again.' })
            };
        }

        // Match recommended product IDs to full product data
        const recommendations = (Array.isArray(analysisResult.recommendedProductIds) ? analysisResult.recommendedProductIds : [])
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

        // Filter and dedupe recommendation IDs after model output.
        const dedupedRecommendations = [];
        const seenProductIds = new Set();
        for (const rec of recommendations) {
            if (seenProductIds.has(rec.product.id)) continue;
            if (douxFocus && !mensMode && !isDouxProduct(rec.product)) continue;
            seenProductIds.add(rec.product.id);
            dedupedRecommendations.push(rec);
        }

        const fallbackPool = (douxFocus && !mensMode)
            ? relevantProducts.filter(isDouxProduct)
            : relevantProducts;
        for (const product of fallbackPool) {
            if (dedupedRecommendations.length >= 3) break;
            if (seenProductIds.has(product.id)) continue;
            seenProductIds.add(product.id);
            dedupedRecommendations.push({
                product,
                reason: 'Great fit for your routine and a strong add-to-cart pick to start seeing results this week.'
            });
        }

        const finalAnalysis = {
            hairType: firstNonEmpty(analysisResult.analysis?.hairType, extractedProfile.hairType, 'Hair type not clearly visible'),
            hairColor: firstNonEmpty(analysisResult.analysis?.hairColor, extractedProfile.hairColor, 'Hair color not clearly visible'),
            condition: firstNonEmpty(analysisResult.analysis?.condition, extractedProfile.condition, 'Condition not clearly visible'),
            texture: firstNonEmpty(analysisResult.analysis?.texture, extractedProfile.texture, 'Texture not clearly visible')
        };

        if (isGenericBrownColor(finalAnalysis.hairColor) && extractedProfile.hairColor && !isGenericBrownColor(extractedProfile.hairColor)) {
            finalAnalysis.hairColor = extractedProfile.hairColor;
        }

        return jsonResponse(200, headers, {
            analysis: finalAnalysis,
            recommendations: dedupedRecommendations.slice(0, 5)
        });
    } catch (error) {
        console.error('Hair analysis error:', error.message, error.stack);
        return jsonResponse(500, headers, { error: 'Something went wrong. Please try again.' });
    }
};
