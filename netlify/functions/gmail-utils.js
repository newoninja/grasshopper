// Gmail API email utility using OAuth2
// Required env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_FROM_EMAIL

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const GMAIL_FROM_EMAIL = process.env.GMAIL_FROM_EMAIL;
const GMAIL_FROM_NAME = 'The Grasshopper';

async function getAccessToken() {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GMAIL_CLIENT_ID,
            client_secret: GMAIL_CLIENT_SECRET,
            refresh_token: GMAIL_REFRESH_TOKEN,
            grant_type: 'refresh_token'
        })
    });

    const data = await response.json();
    if (!data.access_token) {
        throw new Error('Failed to get Gmail access token: ' + JSON.stringify(data));
    }
    return data.access_token;
}

function buildMimeMessage({ to, subject, textBody, htmlBody }) {
    const boundary = 'boundary_' + Date.now();
    const fromHeader = `"${GMAIL_FROM_NAME}" <${GMAIL_FROM_EMAIL}>`;

    let message = [
        `From: ${fromHeader}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
    ];

    if (htmlBody) {
        message.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, '');
        message.push(`--${boundary}`);
        message.push('Content-Type: text/plain; charset="UTF-8"', '');
        message.push(textBody || '', '');
        message.push(`--${boundary}`);
        message.push('Content-Type: text/html; charset="UTF-8"', '');
        message.push(htmlBody, '');
        message.push(`--${boundary}--`);
    } else {
        message.push('Content-Type: text/plain; charset="UTF-8"', '');
        message.push(textBody);
    }

    return message.join('\r\n');
}

function base64UrlEncode(str) {
    return Buffer.from(str)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function sendEmail({ to, subject, textBody, htmlBody }) {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_FROM_EMAIL) {
        console.log('Gmail not configured, email not sent:', { to, subject });
        return false;
    }

    const accessToken = await getAccessToken();
    const mimeMessage = buildMimeMessage({ to, subject, textBody, htmlBody });
    const encodedMessage = base64UrlEncode(mimeMessage);

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: encodedMessage })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error('Gmail send failed: ' + JSON.stringify(error));
    }

    return true;
}

// ============================================
// Email Templates
// ============================================

function buildCustomerReceiptHtml({ items, subtotal, shipping, tax, discount, total, orderId, orderType, promoCode }) {
    const itemRows = items.map(item => `
        <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #eee; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333;">
                ${item.name} <span style="color: #888;">&times; ${item.quantity || 1}</span>
            </td>
            <td style="padding: 12px 0; border-bottom: 1px solid #eee; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; text-align: right;">
                $${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
            </td>
        </tr>
    `).join('');

    const discountRow = discount > 0 ? `
        <tr>
            <td style="padding: 8px 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #2d8a4e;">
                Discount${promoCode ? ` (${promoCode})` : ''}
            </td>
            <td style="padding: 8px 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #2d8a4e; text-align: right;">
                -$${discount.toFixed(2)}
            </td>
        </tr>
    ` : '';

    return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f5f5f0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f0; padding: 40px 20px;">
        <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; max-width: 600px;">
                <!-- Header -->
                <tr>
                    <td style="background-color: #2c2c2c; padding: 32px 40px; text-align: center;">
                        <h1 style="margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 400; color: #ffffff; letter-spacing: 1px;">The Grasshopper</h1>
                    </td>
                </tr>

                <!-- Confirmation -->
                <tr>
                    <td style="padding: 40px 40px 20px;">
                        <h2 style="margin: 0 0 8px; font-family: Georgia, 'Times New Roman', serif; font-size: 22px; color: #333;">Order Confirmed</h2>
                        <p style="margin: 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #888;">Order #${orderId ? orderId.slice(-8).toUpperCase() : '---'}</p>
                        <p style="margin: 16px 0 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 15px; color: #555; line-height: 1.5;">
                            Thank you for your order! ${orderType === 'pickup' ? "We'll contact you within 24 hours to arrange pickup." : "Your order is being prepared and will ship soon."}
                        </p>
                    </td>
                </tr>

                <!-- Items -->
                <tr>
                    <td style="padding: 0 40px;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <td style="padding: 16px 0 8px; border-bottom: 2px solid #333; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 1px;">Item</td>
                                <td style="padding: 16px 0 8px; border-bottom: 2px solid #333; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 1px; text-align: right;">Price</td>
                            </tr>
                            ${itemRows}
                        </table>
                    </td>
                </tr>

                <!-- Totals -->
                <tr>
                    <td style="padding: 20px 40px 0;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <td style="padding: 8px 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #555;">Subtotal</td>
                                <td style="padding: 8px 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #555; text-align: right;">$${subtotal.toFixed(2)}</td>
                            </tr>
                            ${discountRow}
                            <tr>
                                <td style="padding: 8px 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #555;">Shipping</td>
                                <td style="padding: 8px 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #555; text-align: right;">${orderType === 'pickup' ? 'Free (Local Pickup)' : '$' + shipping.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #555;">Tax</td>
                                <td style="padding: 8px 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #555; text-align: right;">$${tax.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td style="padding: 16px 0 8px; border-top: 2px solid #333; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 18px; font-weight: 600; color: #333;">Total</td>
                                <td style="padding: 16px 0 8px; border-top: 2px solid #333; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 18px; font-weight: 600; color: #333; text-align: right;">$${total.toFixed(2)}</td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- Footer -->
                <tr>
                    <td style="padding: 40px; text-align: center;">
                        <p style="margin: 0 0 8px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #aaa;">Questions? Call us at (844) 621-5787</p>
                        <p style="margin: 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #aaa;">The Grasshopper &mdash; 1515 Burtonwood Cir, Charlotte, NC</p>
                    </td>
                </tr>
            </table>
        </td></tr>
    </table>
</body>
</html>`;
}

function buildOwnerNotificationText({ items, subtotal, shipping, tax, discount, total, orderId, paymentId, orderType, phone, email, shippingAddress, promoCode }) {
    const itemsList = items.map(item =>
        `- ${item.name} (Qty: ${item.quantity || 1}) - $${(item.price || 0).toFixed(2)}`
    ).join('\n');

    const isFree = paymentId === 'FREE';

    let addressBlock = '';
    if (shippingAddress && orderType !== 'pickup') {
        addressBlock = `\nShipping To:
${shippingAddress.firstName} ${shippingAddress.lastName}
${shippingAddress.street}${shippingAddress.apt ? ', ' + shippingAddress.apt : ''}
${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}\n`;
    }

    return `New ${orderType === 'pickup' ? 'Local Pickup' : 'Shipping'} Order — ${isFree ? 'FREE ORDER' : 'PAID'}

Customer Phone: ${phone || 'Not provided'}
Customer Email: ${email || 'Not provided'}
${addressBlock}
Items:
${itemsList}

Subtotal: $${subtotal.toFixed(2)}
${discount > 0 ? `Discount${promoCode ? ` (${promoCode})` : ''}: -$${discount.toFixed(2)}\n` : ''}Shipping: ${orderType === 'pickup' ? '$0.00 (Local Pickup)' : '$' + shipping.toFixed(2)}
Tax: $${tax.toFixed(2)}
Total: $${total.toFixed(2)}

Payment ID: ${paymentId}
Order ID: ${orderId}

---
${orderType === 'pickup'
    ? `Please contact the customer at ${phone} within 24 hours to arrange pickup.`
    : `Order needs to be shipped to the address above.`}
`;
}

module.exports = { sendEmail, buildCustomerReceiptHtml, buildOwnerNotificationText };
