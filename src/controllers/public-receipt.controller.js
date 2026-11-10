import PDFDocument from "pdfkit";
import jwt from "jsonwebtoken";
import CustomerFeedback from "../models/customer-feedback.model.js";
import { getPublicReceipt } from "../services/whatsapp-bills.js";

function verifyReceiptToken(token) {
    const secret = process.env.PUBLIC_RECEIPT_SECRET;
    if (!secret || secret.length < 32) throw Object.assign(new Error("PUBLIC_RECEIPT_SECRET must contain at least 32 characters."), { status: 503 });
    try {
        const payload = jwt.verify(token, secret, { issuer: "sfh-pos-receipts" });
        if (typeof payload !== "object" || !/^[1-9]\d*$/.test(String(payload.sub))) throw new Error("Invalid receipt.");
        return String(payload.sub);
    } catch (error) {
        if (error.status) throw error;
        throw Object.assign(new Error("This receipt link is invalid or has expired."), { status: 401 });
    }
}

export async function getReceipt(req, res, next) {
    try {
        const saleId = verifyReceiptToken(req.params.token);
        const receipt = await getPublicReceipt(saleId);
        if (!receipt) return res.status(404).json({ success: false, message: "Paid receipt not found." });
        res.setHeader("Cache-Control", "private, no-store");
        return res.json({ success: true, receipt });
    } catch (error) {
        return next(error);
    }
}

export async function getReceiptPdf(req, res, next) {
    try {
        const saleId = verifyReceiptToken(req.params.token);
        const receipt = await getPublicReceipt(saleId);
        if (!receipt) return res.status(404).json({ success: false, message: "Paid receipt not found." });

        const filename = `${receipt.number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        res.setHeader("Cache-Control", "private, no-store");
        const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Receipt ${receipt.number}` } });
        document.on("error", next);
        document.pipe(res);
        document.fontSize(18).font("Helvetica-Bold").text("Surya Food Hub", { align: "center" });
        document.moveDown(0.5).fontSize(11).font("Helvetica").text(`Tax invoice | ${receipt.number}`, { align: "center" });
        document.text(new Date(receipt.date).toLocaleString("en-IN"), { align: "center" });
        document.moveDown().moveTo(48, document.y).lineTo(547, document.y).stroke();
        document.moveDown();
        for (const item of receipt.items) {
            document.font("Helvetica").text(`${item.quantity} x ${item.name}`, 48, document.y, { continued: true, width: 380 });
            document.text(`INR ${item.lineTotal.toFixed(2)}`, { align: "right" });
        }
        document.moveDown().moveTo(48, document.y).lineTo(547, document.y).stroke().moveDown();
        document.text(`Subtotal: INR ${receipt.subtotal.toFixed(2)}`, { align: "right" });
        if (receipt.discount > 0) document.text(`Discount: -INR ${receipt.discount.toFixed(2)}`, { align: "right" });
        if (receipt.tax > 0) document.text(`Tax: INR ${receipt.tax.toFixed(2)}`, { align: "right" });
        document.moveDown(0.5).font("Helvetica-Bold").fontSize(14).text(`Total paid: INR ${receipt.total.toFixed(2)}`, { align: "right" });
        document.font("Helvetica").fontSize(10).text(`Payment method: ${receipt.paymentMethod}`, { align: "right" });
        document.moveDown(2).fontSize(10).text("Thank you for dining with us!", { align: "center" });
        document.end();
        return undefined;
    } catch (error) {
        return next(error);
    }
}

export async function submitReceiptFeedback(req, res, next) {
    try {
        const saleId = verifyReceiptToken(req.params.token);
        const rating = Number(req.body?.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            throw Object.assign(new Error("Rating must be a whole number from 1 to 5."), { status: 400 });
        }
        const [feedback, created] = await CustomerFeedback.findOrCreate({
            where: { sale_id: saleId },
            defaults: { sale_id: saleId, rating },
        });
        if (!created && feedback.rating !== rating) await feedback.update({ rating });
        return res.json({ success: true, rating: created ? rating : feedback.rating });
    } catch (error) {
        return next(error);
    }
}
