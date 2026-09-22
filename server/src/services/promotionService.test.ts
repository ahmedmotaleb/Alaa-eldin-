import { describe, expect, it } from 'vitest'
import { computePromotionApplications, type ActivePromotion, type PromotionCartItem, type PromotionRow } from './promotionService.js'

function makePromotion(overrides: Partial<PromotionRow> = {}): PromotionRow {
  return {
    id: 'promo_1',
    name: 'عرض اختبار',
    type: 'buy_x_get_y',
    active: 1,
    startsAt: null,
    expiresAt: null,
    priority: 0,
    maxApplicationsPerOrder: null,
    triggerProductId: null,
    triggerCategoryId: null,
    buyQuantity: null,
    getQuantity: null,
    getDiscountPercent: null,
    rewardProductId: null,
    rewardCategoryId: null,
    bundlePrice: null,
    createdAt: new Date().toISOString(),
    createdBy: null,
    ...overrides
  }
}

function activate(promotion: PromotionRow, bundleItems: ActivePromotion['bundleItems'] = []): ActivePromotion {
  return { promotion, bundleItems }
}

describe('computePromotionApplications — buy_x_get_y (same group, free reward)', () => {
  const promotion = makePromotion({
    triggerProductId: 'p1', buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100
  })

  it('applies once for exactly buy+get quantity, discounting the cheapest unit', () => {
    const items: PromotionCartItem[] = [{ productId: 'p1', categoryId: 'c1', quantity: 3, unitPrice: 10 }]
    const result = computePromotionApplications(items, [activate(promotion)])
    expect(result.applications).toHaveLength(1)
    expect(result.applications[0].applicationsCount).toBe(1)
    expect(result.applications[0].discountAmount).toBe(10)
    expect(result.totalDiscount).toBe(10)
  })

  it('applies multiple times when quantity allows, and never partially (floor division)', () => {
    const items: PromotionCartItem[] = [{ productId: 'p1', categoryId: 'c1', quantity: 8, unitPrice: 10 }]
    // 8 / (2+1) = 2 applications أرضي (floor), مش 2.66
    const result = computePromotionApplications(items, [activate(promotion)])
    expect(result.applications[0].applicationsCount).toBe(2)
    expect(result.applications[0].discountAmount).toBe(20)
  })

  it('does not apply when quantity is below buy+get threshold', () => {
    const items: PromotionCartItem[] = [{ productId: 'p1', categoryId: 'c1', quantity: 2, unitPrice: 10 }]
    const result = computePromotionApplications(items, [activate(promotion)])
    expect(result.applications).toHaveLength(0)
    expect(result.totalDiscount).toBe(0)
  })

  it('respects max_applications_per_order as a hard cap', () => {
    const capped = makePromotion({ ...promotion, maxApplicationsPerOrder: 1 })
    const items: PromotionCartItem[] = [{ productId: 'p1', categoryId: 'c1', quantity: 9, unitPrice: 10 }]
    const result = computePromotionApplications(items, [activate(capped)])
    expect(result.applications[0].applicationsCount).toBe(1)
  })

  it('a category trigger picks the deterministic cheapest eligible item as the reward', () => {
    const categoryPromotion = makePromotion({
      triggerProductId: null, triggerCategoryId: 'dairy', buyQuantity: 1, getQuantity: 1, getDiscountPercent: 100
    })
    const items: PromotionCartItem[] = [
      { productId: 'milk', categoryId: 'dairy', quantity: 1, unitPrice: 30 },
      { productId: 'cheese', categoryId: 'dairy', quantity: 1, unitPrice: 15 }
    ]
    const result = computePromotionApplications(items, [activate(categoryPromotion)])
    // أرخص وحدة (الجبنة بـ15) هي اللي المفروض تتخصم، مش اللبن الأغلى
    expect(result.applications[0].discountAmount).toBe(15)
  })
})

describe('computePromotionApplications — buy_x_get_y (different reward group)', () => {
  it('consumes separate trigger and reward pools independently', () => {
    const promotion = makePromotion({
      triggerProductId: 'shampoo', buyQuantity: 2, getQuantity: 1, getDiscountPercent: 50,
      rewardProductId: 'conditioner'
    })
    const items: PromotionCartItem[] = [
      { productId: 'shampoo', categoryId: 'care', quantity: 2, unitPrice: 40 },
      { productId: 'conditioner', categoryId: 'care', quantity: 1, unitPrice: 30 }
    ]
    const result = computePromotionApplications(items, [activate(promotion)])
    expect(result.applications[0].applicationsCount).toBe(1)
    expect(result.applications[0].discountAmount).toBe(15) // 50% من 30
  })

  it('is limited by whichever pool (trigger or reward) runs out first', () => {
    const promotion = makePromotion({
      triggerProductId: 'shampoo', buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100,
      rewardProductId: 'conditioner'
    })
    const items: PromotionCartItem[] = [
      { productId: 'shampoo', categoryId: 'care', quantity: 10, unitPrice: 40 }, // كفاية 5 تطبيقات
      { productId: 'conditioner', categoryId: 'care', quantity: 1, unitPrice: 30 } // بس مفيش غير مكيّف واحد
    ]
    const result = computePromotionApplications(items, [activate(promotion)])
    expect(result.applications[0].applicationsCount).toBe(1)
  })
})

describe('computePromotionApplications — bundle_fixed_price', () => {
  it('applies a single-group bundle when enough matching units exist', () => {
    const promotion = makePromotion({
      type: 'bundle_fixed_price', triggerProductId: null, bundlePrice: 25,
      buyQuantity: null, getQuantity: null, getDiscountPercent: null
    })
    const bundleItems = [{ id: 1, promotionId: 'promo_1', productId: 'soda', categoryId: null, requiredQuantity: 3 }]
    const items: PromotionCartItem[] = [{ productId: 'soda', categoryId: 'drinks', quantity: 3, unitPrice: 10 }]
    const result = computePromotionApplications(items, [activate(promotion, bundleItems)])
    // الطبيعي 30، الباقة بـ25 -> خصم 5
    expect(result.applications[0].discountAmount).toBe(5)
  })

  it('combines multiple distinct groups into one bundle price', () => {
    const promotion = makePromotion({ type: 'bundle_fixed_price', bundlePrice: 40 })
    const bundleItems = [
      { id: 1, promotionId: 'promo_1', productId: 'shampoo', categoryId: null, requiredQuantity: 1 },
      { id: 2, promotionId: 'promo_1', productId: 'conditioner', categoryId: null, requiredQuantity: 1 },
      { id: 3, promotionId: 'promo_1', productId: null, categoryId: 'snacks', requiredQuantity: 1 }
    ]
    const items: PromotionCartItem[] = [
      { productId: 'shampoo', categoryId: 'care', quantity: 1, unitPrice: 20 },
      { productId: 'conditioner', categoryId: 'care', quantity: 1, unitPrice: 20 },
      { productId: 'chips', categoryId: 'snacks', quantity: 1, unitPrice: 15 }
    ]
    const result = computePromotionApplications(items, [activate(promotion, bundleItems)])
    // الطبيعي 55، الباقة بـ40 -> خصم 15
    expect(result.applications[0].discountAmount).toBe(15)
  })

  it('never applies a negative discount when bundle price is not actually cheaper', () => {
    const promotion = makePromotion({ type: 'bundle_fixed_price', bundlePrice: 100 })
    const bundleItems = [{ id: 1, promotionId: 'promo_1', productId: 'soda', categoryId: null, requiredQuantity: 1 }]
    const items: PromotionCartItem[] = [{ productId: 'soda', categoryId: 'drinks', quantity: 1, unitPrice: 10 }]
    const result = computePromotionApplications(items, [activate(promotion, bundleItems)])
    expect(result.applications).toHaveLength(0)
  })

  it('does not trigger when one required group is missing entirely', () => {
    const promotion = makePromotion({ type: 'bundle_fixed_price', bundlePrice: 40 })
    const bundleItems = [
      { id: 1, promotionId: 'promo_1', productId: 'shampoo', categoryId: null, requiredQuantity: 1 },
      { id: 2, promotionId: 'promo_1', productId: 'conditioner', categoryId: null, requiredQuantity: 1 }
    ]
    const items: PromotionCartItem[] = [{ productId: 'shampoo', categoryId: 'care', quantity: 5, unitPrice: 20 }]
    const result = computePromotionApplications(items, [activate(promotion, bundleItems)])
    expect(result.applications).toHaveLength(0)
  })
})

describe('computePromotionApplications — multiple promotions in one cart (no double-dipping)', () => {
  it('processes promotions in priority order and never lets one cart unit fund two discounts', () => {
    const bogo = makePromotion({
      id: 'promo_bogo', priority: 10, triggerProductId: 'p1', buyQuantity: 1, getQuantity: 1, getDiscountPercent: 100
    })
    const bundle = makePromotion({
      id: 'promo_bundle', type: 'bundle_fixed_price', priority: 0, bundlePrice: 5
    })
    const bundleItems = [{ id: 1, promotionId: 'promo_bundle', productId: 'p1', categoryId: null, requiredQuantity: 2 }]

    // مخزون كافي بالظبط لعرض واحد بس فعلياً (BOGO الأعلى أولوية بياخد وحدتين، يفضل صفر
    // للباقة اللي محتاجة وحدتين كمان).
    const items: PromotionCartItem[] = [{ productId: 'p1', categoryId: 'c1', quantity: 2, unitPrice: 10 }]
    const result = computePromotionApplications(items, [activate(bogo), activate(bundle, bundleItems)])

    expect(result.applications).toHaveLength(1)
    expect(result.applications[0].promotionId).toBe('promo_bogo')
    expect(result.totalDiscount).toBe(10)
  })

  it('lets two independent promotions both apply when there is enough distinct stock left after the first consumes its share', () => {
    // BOGO محدود بتطبيق واحد بس (سقف صريح) — فبيستهلك وحدتين بس من الأربعة المتاحة،
    // ويسيب وحدتين بالظبط كافيين لتفعيل الباقة كمان في نفس السلة.
    const bogo = makePromotion({
      id: 'promo_bogo', priority: 10, triggerProductId: 'p1', buyQuantity: 1, getQuantity: 1,
      getDiscountPercent: 100, maxApplicationsPerOrder: 1
    })
    const bundle = makePromotion({
      id: 'promo_bundle', type: 'bundle_fixed_price', priority: 0, bundlePrice: 5
    })
    const bundleItems = [{ id: 1, promotionId: 'promo_bundle', productId: 'p1', categoryId: null, requiredQuantity: 2 }]

    const items: PromotionCartItem[] = [{ productId: 'p1', categoryId: 'c1', quantity: 4, unitPrice: 10 }]
    const result = computePromotionApplications(items, [activate(bogo), activate(bundle, bundleItems)])

    expect(result.applications).toHaveLength(2)
    expect(result.applications.find(a => a.promotionId === 'promo_bogo')?.discountAmount).toBe(10)
    expect(result.applications.find(a => a.promotionId === 'promo_bundle')?.discountAmount).toBe(15)
  })
})
