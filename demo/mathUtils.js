export function calculateDiscount(price, rate) {
    return price * (1 - rate);
}

export function formatPrice(amount) {
    return `$${amount.toFixed(2)}`;
}
