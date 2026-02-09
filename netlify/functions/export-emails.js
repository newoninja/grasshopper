const https = require('https');

function netlifyRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.netlify.com',
            path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.NETLIFY_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`Netlify API ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

exports.handler = async (event) => {
    // Simple auth check via query param
    const params = event.queryStringParameters || {};
    if (params.key !== process.env.ADMIN_KEY) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const siteId = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;

    if (!siteId || !token) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Missing NETLIFY_SITE_ID or NETLIFY_API_TOKEN environment variables' })
        };
    }

    try {
        // Get all forms for the site
        const forms = await netlifyRequest(`/api/v1/sites/${siteId}/forms`);
        const newsletterForm = forms.find(f => f.name === 'newsletter');

        if (!newsletterForm) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Newsletter form not found. Make sure the form name is "newsletter".' })
            };
        }

        // Fetch all submissions (paginated, up to 1000)
        let allSubmissions = [];
        let page = 1;
        const perPage = 100;

        while (true) {
            const submissions = await netlifyRequest(
                `/api/v1/forms/${newsletterForm.id}/submissions?per_page=${perPage}&page=${page}`
            );
            allSubmissions = allSubmissions.concat(submissions);
            if (submissions.length < perPage) break;
            page++;
        }

        const format = params.format || 'json';

        if (format === 'csv') {
            // Build CSV
            let csv = 'Email,Date Submitted\n';
            allSubmissions.forEach(sub => {
                const email = (sub.data?.email || sub.email || '').replace(/"/g, '""');
                const date = sub.created_at ? new Date(sub.created_at).toLocaleDateString('en-US') : '';
                csv += `"${email}","${date}"\n`;
            });

            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': 'attachment; filename="newsletter-emails.csv"'
                },
                body: csv
            };
        }

        // JSON format (for the admin page table)
        const emails = allSubmissions.map(sub => ({
            email: sub.data?.email || sub.email || '',
            date: sub.created_at || ''
        }));

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ total: emails.length, emails })
        };
    } catch (error) {
        console.error('Export emails error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
