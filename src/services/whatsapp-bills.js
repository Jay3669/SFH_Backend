import jwt from "jsonwebtoken";
import PosSale from "../models/pos-sale.model.js";
import WhatsAppDelivery from "../models/whatsapp-delivery.model.js";
import PosSaleItem from "../models/pos-sale-item.model.js";
import { logger } from "../utils/logger.js";

function publicReceiptToken(saleId) {
    const secret = process.env.PUBLIC_RECEIPT_SECRET;
    if (!secret || secret.length < 32) throw new Error("PUBLIC_RECEIPT_SECRET must contain at least 32 characters.");
    return jwt.sign({ sub: String(saleId) }, secret, { expiresIn: "30d", issuer: "sfh-pos-receipts" });
}

function receiptLinks(saleId) {
    const base = process.env.PUBLIC_RECEIPT_BASE_URL;
    const apiBase = process.env.PUBLIC_RECEIPT_API_BASE_URL;
    if (!base) throw new Error("PUBLIC_RECEIPT_BASE_URL must be configured before WhatsApp bill delivery.");
    if (!apiBase) throw new Error("PUBLIC_RECEIPT_API_BASE_URL must be configured for PDF bill delivery.");
    const appUrl = new URL(base);
    const apiUrl = new URL(apiBase);
    if (![appUrl.protocol, apiUrl.protocol].every((protocol) => ["http:", "https:"].includes(protocol))) {
        throw new Error("Public receipt URLs must use HTTP or HTTPS.");
    }
    if (process.env.NODE_ENV === "production" && [appUrl, apiUrl].some((url) => url.protocol !== "https:")) {
        throw new Error("Public receipt URLs must use HTTPS in production.");
    }
    const token = encodeURIComponent(publicReceiptToken(saleId));
    const root = base.replace(/\/+$/, "");
    const apiRoot = apiBase.replace(/\/+$/, "");
    return {
        pdf: `${apiRoot}/receipts/${token}/pdf`,
        feedback: `${root}/customer/feedback?token=${token}`,
    };
}

async function postTemplate(phoneNumber, sale, links) {
    const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    const templateName = process.env.META_WHATSAPP_TEMPLATE_NAME;
    const version = process.env.META_WHATSAPP_API_VERSION;
    if (!token || !phoneNumberId || !templateName || !version) {
        throw new Error("WhatsApp Cloud API credentials, META_WHATSAPP_TEMPLATE_NAME, and META_WHATSAPP_API_VERSION are required.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: phoneNumber.replace(/^\+/, ""),
                type: "template",
                template: {
                    name: templateName,
                    language: { code: process.env.META_WHATSAPP_TEMPLATE_LANGUAGE || "en" },
                    components: [{
                        type: "body",
                        parameters: [
                            { type: "text", text: sale.bill_number },
                            { type: "text", text: `₹${Number(sale.total_amount).toFixed(2)}` },
                            { type: "text", text: links.pdf },
                            { type: "text", text: links.feedback },
                        ],
                    }],
                },
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const reason = result.error?.message || `WhatsApp Cloud API returned HTTP ${response.status}.`;
            throw new Error(reason);
        }
        return result.messages?.[0]?.id || null;
    } finally {
        clearTimeout(timeout);
    }
}

export async function sendWhatsAppBill(sale, { retry = false } = {}) {
    if (!sale.whatsapp_opt_in || !sale.customer_phone) return { status: "skipped" };
    if (sale.status !== "Paid") return { status: "pending_payment" };
    try {
        const [delivery, created] = await WhatsAppDelivery.findOrCreate({
            where: { sale_id: sale.pos_sale_id },
            defaults: { sale_id: sale.pos_sale_id, phone_number: sale.customer_phone, status: "pending" },
        });
        if (!created && (!retry || delivery.status !== "failed")) {
            return { status: delivery.status, messageId: delivery.provider_message_id || null, message: delivery.error_message || "" };
        }
        if (!created) await delivery.update({ status: "pending", error_message: null });
        const links = receiptLinks(sale.pos_sale_id);
        const providerMessageId = await postTemplate(sale.customer_phone, sale, links);
        await delivery.update({ status: "sent", provider_message_id: providerMessageId, sent_at: new Date() });
        return { status: "sent", messageId: providerMessageId };
    } catch (error) {
        logger.error("WhatsApp bill delivery failed", {
            saleId: String(sale.pos_sale_id),
            message: error.message,
        });
        try {
            const delivery = await WhatsAppDelivery.findOne({ where: { sale_id: sale.pos_sale_id } });
            if (delivery) await delivery.update({ status: "failed", error_message: error.message.slice(0, 500) });
        } catch (trackingError) {
            logger.error("Unable to record WhatsApp bill delivery failure", {
                saleId: String(sale.pos_sale_id),
                message: trackingError.message,
            });
        }
        return { status: "failed", message: error.message };
    }
}

export async function getPublicReceipt(saleId) {
    const sale = await PosSale.findByPk(saleId);
    if (!sale || sale.status !== "Paid") return null;
    const items = await PosSaleItem.findAll({
        where: { sale_id: saleId },
        order: [["pos_sale_item_id", "ASC"]],
        attributes: ["item_name", "quantity", "unit_price", "line_total"],
    });
    return {
        number: sale.bill_number,
        date: sale.completed_at,
        items: items.map((item) => ({
            name: item.item_name,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unit_price),
            lineTotal: Number(item.line_total),
        })),
        subtotal: Number(sale.subtotal),
        discount: Number(sale.discount_amount),
        tax: Number(sale.tax_amount),
        total: Number(sale.total_amount),
        paymentMethod: sale.payment_method,
    };
}
