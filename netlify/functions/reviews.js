const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    connectLambda(event);
    const store = getStore('reviews');

    if (event.httpMethod === 'GET') {
        const productId = event.queryStringParameters?.productId;
        if (!productId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'productId required' }) };
        }

        try {
            const data = await store.get(productId);
            const reviews = data ? JSON.parse(data) : [];
            return { statusCode: 200, headers, body: JSON.stringify(reviews) };
        } catch (e) {
            return { statusCode: 200, headers, body: JSON.stringify([]) };
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const { productId, name, rating, text, image } = JSON.parse(event.body);

            if (!productId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'productId required' }) };
            }
            if (!name || !name.trim()) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name is required' }) };
            }
            const ratingNum = parseInt(rating);
            if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Rating must be 1-5' }) };
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

            return { statusCode: 200, headers, body: JSON.stringify(reviews) };
        } catch (e) {
            console.error('Review POST error:', e);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to save review' }) };
        }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
