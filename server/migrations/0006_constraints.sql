-- قيود حماية على مستوى قاعدة البيانات نفسها — خط دفاع أخير حتى لو حصل خطأ برمجي مستقبلي
-- في طبقة التطبيق يحاول يدخل قيمة فلوس/كمية سالبة أو حالة طلب مش معروفة. البيانات الحالية
-- بتحقق كل القيود دي أصلاً (طبقة التطبيق كانت بترفضها من الأول)، فمفيش خطر فشل الترحيل.
ALTER TABLE products ADD CONSTRAINT products_price_check CHECK (price >= 0);
ALTER TABLE products ADD CONSTRAINT products_old_price_check CHECK (old_price IS NULL OR old_price >= 0);
ALTER TABLE products ADD CONSTRAINT products_cost_check CHECK (cost >= 0);
ALTER TABLE products ADD CONSTRAINT products_stock_check CHECK (stock >= 0);

ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_check CHECK (quantity > 0);
ALTER TABLE order_items ADD CONSTRAINT order_items_unit_price_check CHECK (unit_price >= 0);
ALTER TABLE order_items ADD CONSTRAINT order_items_line_total_check CHECK (line_total >= 0);

ALTER TABLE orders ADD CONSTRAINT orders_subtotal_check CHECK (subtotal >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_delivery_fee_check CHECK (delivery_fee >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_discount_amount_check CHECK (discount_amount >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_total_check CHECK (total >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('placed', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled'));

ALTER TABLE discounts ADD CONSTRAINT discounts_value_check CHECK (value >= 0);
ALTER TABLE discounts ADD CONSTRAINT discounts_min_order_check CHECK (min_order >= 0);

ALTER TABLE settlements ADD CONSTRAINT settlements_amount_check CHECK (amount >= 0);
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_check CHECK (amount >= 0);
