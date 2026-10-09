const { bad } = require("../utils/errors");

// Reasons a discount can't apply. Pure: takes already-loaded data so it is trivially testable.
function checkDiscount(
  discount,
  { planId, now = new Date(), userRedemptions = 0 },
) {
  if (!discount) return "Discount code not found";
  if (!discount.enabled) return "Discount is disabled";
  if (discount.startsAt && now < discount.startsAt)
    return "Discount is not active yet";
  if (discount.endsAt && now > discount.endsAt) return "Discount has expired";
  if (
    discount.planIds &&
    discount.planIds.length &&
    !discount.planIds.map(String).includes(String(planId))
  )
    return "Discount does not apply to this plan";
  if (
    discount.maxRedemptions != null &&
    discount.redeemedCount >= discount.maxRedemptions
  )
    return "Discount usage limit reached";
  if (discount.perUserLimit != null && userRedemptions >= discount.perUserLimit)
    return "You have already used this discount";
  return null;
}

// Integer minor units only (no float drift). Result is clamped to [0, price]; server-side only.
function computePrice(plan, discount) {
  const original = plan.priceMinor;
  let off = 0;
  if (discount) {
    off =
      discount.type === "PERCENT"
        ? Math.round((original * discount.value) / 100)
        : Math.round(discount.value);
    off = Math.max(0, Math.min(off, original));
  }
  return {
    originalPriceMinor: original,
    discountMinor: off,
    finalPriceMinor: original - off,
    currency: plan.currency,
  };
}

function applyDiscount(plan, discount, ctx) {
  const problem = discount
    ? checkDiscount(discount, { planId: plan._id, ...ctx })
    : null;
  if (problem) throw bad(problem, "DISCOUNT_INVALID");
  return computePrice(plan, discount);
}
const toGatewayAmount = (minor) => (minor / 100).toFixed(2);
module.exports = {
  checkDiscount,
  computePrice,
  applyDiscount,
  toGatewayAmount,
};
