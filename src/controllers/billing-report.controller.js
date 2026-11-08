import { Op } from "sequelize";
import InventoryPayment from "../models/inventory-payment.model.js";
import InventoryPurchase from "../models/inventory-purchase.model.js";
import PosSale from "../models/pos-sale.model.js";
import PosSaleItem from "../models/pos-sale-item.model.js";
import PosSaleTender from "../models/pos-sale-tender.model.js";
import { getBillingPeriodRange, summarizeBillingReport } from "../services/billing-report.js";

function serializePurchase(purchase) {
    return {
        id: String(purchase.inventory_purchase_id),
        billNumber: purchase.order_number,
        invoice: purchase.invoice_reference,
        supplier: purchase.supplier_name,
        supplierId: String(purchase.supplier_id),
        item: purchase.item_name,
        itemId: String(purchase.item_id),
        date: purchase.createdAt,
        orderDate: purchase.order_date,
        status: purchase.status,
        quantity: Number(purchase.quantity),
        receivedQuantity: Number(purchase.received_quantity),
        unit: purchase.unit,
        unitPrice: Number(purchase.unit_price),
        paidAmount: Number(purchase.paid_amount),
        due: purchase.status === "Cancelled"
            ? 0
            : Math.max(0, Number(purchase.quantity) * Number(purchase.unit_price) - Number(purchase.paid_amount)),
        expiry: purchase.expiry_date || "",
        payments: [],
        total: Math.round((Number(purchase.quantity) * Number(purchase.unit_price) + Number.EPSILON) * 100) / 100,
    };
}

export const getBillingReport = async (req, res, next) => {
    try {
        const period = req.query.period;
        const range = getBillingPeriodRange(period);
        const [purchases, sales] = await Promise.all([
            InventoryPurchase.findAll({
                where: {
                    createdAt: { [Op.gte]: range.startAt, [Op.lt]: range.endAt },
                },
                order: [["createdAt", "DESC"]],
            }),
            PosSale.findAll({
                where: { completed_at: { [Op.gte]: range.startAt, [Op.lt]: range.endAt } },
                order: [["completed_at", "DESC"]],
            }),
        ]);
        const [purchasePayments, saleItems] = await Promise.all([
            purchases.length
                ? InventoryPayment.findAll({
                    where: { purchase_id: { [Op.in]: purchases.map((purchase) => purchase.inventory_purchase_id) } },
                    order: [["createdAt", "ASC"], ["inventory_payment_id", "ASC"]],
                })
                : [],
            sales.length
                ? PosSaleItem.findAll({
                where: { sale_id: { [Op.in]: sales.map((sale) => sale.pos_sale_id) } },
                order: [["pos_sale_item_id", "ASC"]],
                })
                : [],
        ]);
        const paymentsByPurchase = new Map();
        for (const payment of purchasePayments) {
            const purchaseId = String(payment.purchase_id);
            if (!paymentsByPurchase.has(purchaseId)) paymentsByPurchase.set(purchaseId, []);
            paymentsByPurchase.get(purchaseId).push({
                amount: Number(payment.amount),
                reference: payment.reference || "",
                date: payment.createdAt,
            });
        }
        const itemsBySale = new Map();
        for (const item of saleItems) {
            const saleId = String(item.sale_id);
            if (!itemsBySale.has(saleId)) itemsBySale.set(saleId, []);
            itemsBySale.get(saleId).push({
                name: item.item_name,
                quantity: Number(item.quantity),
                total: Number(item.line_total),
            });
        }
        const serializedSales = sales.map((sale) => ({
            id: String(sale.pos_sale_id),
            billNumber: sale.bill_number,
            date: sale.completed_at,
            status: sale.status,
            paymentMethod: sale.payment_method,
            orderType: sale.order_type,
            items: itemsBySale.get(String(sale.pos_sale_id)) || [],
            subtotal: Number(sale.subtotal),
            discount: Number(sale.discount_amount),
            packaging: Number(sale.packaging_amount),
            tax: Number(sale.tax_amount),
            total: Number(sale.total_amount),
            amountTendered: Number(sale.amount_tendered),
            amountPaid: Number(sale.amount_paid),
            changeDue: Number(sale.change_due),
            balanceDue: Number(sale.balance_due),
            tenders: [],
        }));
        const saleTenders = sales.length
            ? await PosSaleTender.findAll({
                where: { sale_id: { [Op.in]: sales.map((sale) => sale.pos_sale_id) } },
                order: [["pos_sale_tender_id", "ASC"]],
            })
            : [];
        const tendersBySale = new Map();
        for (const tender of saleTenders) {
            const saleId = String(tender.sale_id);
            if (!tendersBySale.has(saleId)) tendersBySale.set(saleId, []);
            tendersBySale.get(saleId).push({ method: tender.method, amount: Number(tender.amount) });
        }
        for (const sale of serializedSales) sale.tenders = tendersBySale.get(sale.id) || [];
        const serializedPurchases = purchases.map((purchase) => ({
            ...serializePurchase(purchase),
            payments: paymentsByPurchase.get(String(purchase.inventory_purchase_id)) || [],
        }));
        const activePurchaseSummary = summarizeBillingReport(
            serializedPurchases.filter((purchase) => purchase.status !== "Cancelled"),
            serializedSales
        );
        const allPurchases = summarizeBillingReport(serializedPurchases, serializedSales);
        return res.json({
            success: true,
            report: {
                period,
                from: range.from,
                to: range.to,
                ...allPurchases,
                purchases: {
                    ...allPurchases.purchases,
                    count: activePurchaseSummary.purchases.count,
                    total: activePurchaseSummary.purchases.total,
                },
                grandTotal: activePurchaseSummary.grandTotal,
            },
        });
    } catch (error) {
        return next(error);
    }
};
