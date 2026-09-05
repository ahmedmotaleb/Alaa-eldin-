# خريطة المكونات والبيانات

## المكونات

- `Layout`: الهيدر + عداد السلة + زر واتساب + شريط التنقل السفلي.
- `SearchBar`: البحث.
- `ProductCard`: بطاقة المنتج.
- `ProductGrid`: شبكة المنتجات.
- `QuantityCounter`: التحكم في الكمية.
- `Section`: عناوين أقسام الرئيسية.
- `CartContext`: عمليات السلة والحسابات والحفظ المحلي.

## نماذج البيانات

### Product
- id
- slug
- categoryId
- name
- description
- price
- oldPrice
- unit
- available
- image
- bestseller
- offer
- newArrival
- orderCount

### Category
- id
- name
- emoji
- image

### CartItem
- productId
- quantity

### Order
- id
- createdAt
- customer
- deliverySlot
- paymentMethod
- items
- subtotal
- deliveryFee
- total

## أماكن التخصيص

- اسم المتجر والشحن والحد الأدنى ورقم واتساب:
  `src/config/store.ts`
- الأقسام:
  `src/data/categories.ts`
- المنتجات:
  `src/data/products.ts`
- التصميم:
  `src/styles.css`
