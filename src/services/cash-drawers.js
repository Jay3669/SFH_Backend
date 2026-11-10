export function calculateExpectedCash(openingBalance, cashSales, movements) {
    const movementTotals = movements.reduce((totals, movement) => {
        if (movement.direction === "in") totals.in += Number(movement.amount);
        if (movement.direction === "out") totals.out += Number(movement.amount);
        return totals;
    }, { in: 0, out: 0 });
    return Math.round((Number(openingBalance) + Number(cashSales) + movementTotals.in - movementTotals.out + Number.EPSILON) * 100) / 100;
}

export function calculateCashCollected(sales, paymentsBySale) {
    return Math.round(sales.reduce((total, sale) => {
        const payments = paymentsBySale.get(String(sale.pos_sale_id)) || [];
        const cashTendered = payments.length
            ? payments
                .filter((payment) => String(payment.method).toLowerCase() === "cash")
                .reduce((sum, payment) => sum + Number(payment.amount), 0)
            : String(sale.payment_method).toLowerCase() === "cash"
                ? Number(sale.amount_paid)
                : 0;
        const changeDue = Math.min(Number(sale.change_due) || 0, cashTendered);
        return total + Math.max(0, cashTendered - changeDue);
    }, 0) * 100) / 100;
}
