import { calculateDiscount, shippingFee } from './mathUtils';

function processOrder(cartTotal) {
    const discounted = calculateDiscount(cartTotal);
    return discounted + 5;
}

export { processOrder };
