const { connectLambda, getStore } = require('@netlify/blobs');
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';
const { buildCorsHeaders, jsonResponse, methodNotAllowed, parseJsonBody } = require('./request-utils');

exports.handler = async (event) => {
    const headers = buildCorsHeaders(SITE_ORIGIN);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    connectLambda(event);
    const store = getStore('reviews');

    if (event.httpMethod === 'GET') {
        const productId = event.queryStringParameters?.productId;
        if (!productId) {
            return jsonResponse(400, headers, { error: 'productId required' });
        }

        try {
            const data = await store.get(productId);
            const reviews = data ? JSON.parse(data) : [];
            return jsonResponse(200, headers, reviews);
        } catch (e) {
            return jsonResponse(200, headers, []);
        }
    }

    if (event.httpMethod === 'POST') {
        const parsed = parseJsonBody(event, headers);
        if (!parsed.ok) return parsed.response;

        try {
            const { productId, name, rating, text, image } = parsed.body;

            if (!productId) {
                return jsonResponse(400, headers, { error: 'productId required' });
            }
            if (!name || !name.trim()) {
                return jsonResponse(400, headers, { error: 'Name is required' });
            }
            const ratingNum = parseInt(rating);
            if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
                return jsonResponse(400, headers, { error: 'Rating must be 1-5' });
            }

            let reviews = [];
            try {
                const existing = await store.get(productId);
                if (existing) reviews = JSON.parse(existing);
            } catch (e) {
                // No existing reviews
            }

            const review = {
                name: name.trim(),
                rating: ratingNum,
                text: (text || '').trim(),
                date: new Date().toISOString()
            };
            if (image && typeof image === 'string' && image.startsWith('data:image/')) {
                review.image = image;
            }
            reviews.push(review);

            await store.set(productId, JSON.stringify(reviews));

            return jsonResponse(200, headers, reviews);
        } catch (e) {
            console.error('Review POST error:', e);
            return jsonResponse(500, headers, { error: 'Failed to save review' });
        }
    }

    return methodNotAllowed(headers);
};
