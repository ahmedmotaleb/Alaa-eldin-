// النصوص الظاهرة للعميل - عربي فقط. أي نص جديد يظهر للعميل يجب إضافته هنا
// بدل كتابته مباشرة داخل الصفحات، حتى لو كان التطبيق يدعم العربية فقط حالياً.
export const ar = {
  nav: {
    home: 'الرئيسية',
    categories: 'الأقسام',
    orders: 'طلباتي',
    cart: 'السلة',
    account: 'حسابي',
    mainNavLabel: 'التنقل الرئيسي',
    subTitles: {
      categories: 'كل الأقسام',
      product: 'المنتج',
      search: 'البحث',
      cart: 'سلة التسوق',
      checkout: 'إتمام الطلب',
      confirmation: 'تأكيد الطلب',
      tracking: 'تتبع الطلب',
      orders: 'طلباتي',
      account: 'حسابي',
      genericCategory: 'المنتجات'
    }
  },

  common: {
    openCart: 'فتح السلة',
    back: 'رجوع',
    pressBackAgainToExit: 'اضغط مرة أخرى للخروج',
    viewAll: 'عرض الكل',
    decreaseQty: 'تقليل الكمية',
    increaseQty: 'زيادة الكمية',
    remove: (name: string) => `حذف ${name}`,
    addProductToCart: (name: string) => `أضف ${name} إلى السلة`,
    addedToCart: 'تمت الإضافة إلى السلة ✓',
    noProducts: 'لا توجد منتجات حالياً.',
    loading: 'جارِ التحميل...',
    unit: 'منتج',
    currency: 'ج.م',
    close: 'إغلاق'
  },

  home: {
    deliverTo: 'التوصيل إلى',
    deliveryAddress: 'شارع الجمهورية، طنطا',
    searchPlaceholder: 'ابحث عن منتج... لبن، أرز، طماطم',
    sectionsTitle: 'الأقسام',
    todaysOffersTitle: 'عروض اليوم',
    offersEndIn: 'تنتهي بعد 4 ساعات',
    allOffers: 'كل العروض',
    bestSellersTitle: 'الأكثر مبيعاً',
    orderBeforeTitle: 'اطلب قبل 6 مساءً',
    orderBeforeNote: 'ويوصلك الطلب نفس اليوم داخل المدينة.'
  },

  categories: {
    productsCount: (count: number) => `${count} منتج`
  },

  productList: {
    sortPopular: 'الأكثر طلباً',
    sortLow: 'السعر: الأقل',
    sortHigh: 'السعر: الأعلى',
    loadMore: 'عرض المزيد',
    loadingMore: 'جارِ التحميل...'
  },

  product: {
    available: 'متوفر',
    unavailable: 'غير متوفر',
    unavailableNow: 'غير متوفر حالياً',
    lowStock: 'مخزون منخفض',
    outOfStock: 'نفد من المخزون',
    lowStockRemaining: (count: number) => `متبقي ${count} فقط`,
    pricePerUnit: (unit: string, category: string) => `السعر لكل ${unit} · ${category}`,
    deliveryToday: 'توصيل اليوم',
    exchange24h: 'استبدال خلال 24س',
    checkBeforeDelivery: 'فحص قبل التسليم',
    similarProducts: 'منتجات مشابهة',
    similarAlternatives: 'بدائل مشابهة',
    viewImageLarger: 'اعرض الصورة بحجم أكبر',
    imageNumber: (n: number) => `صورة ${n}`,
    addToCart: 'أضف إلى السلة',
    updateCart: 'تحديث السلة'
  },

  search: {
    placeholder: 'ابحث عن منتج...',
    recentSearches: 'عمليات بحث سابقة',
    trending: 'الأكثر بحثاً',
    resultsCount: (count: number) => `${count} نتيجة`,
    noResultsTitle: (query: string) => `مفيش نتائج لـ "${query}"`,
    noResultsNote: 'جرّب كلمة أبسط، أو اطلب المنتج من خدمة العملاء على واتساب ونوفره لك.',
    browseCategories: 'تصفح الأقسام'
  },

  cart: {
    emptyTitle: 'سلتك فاضية',
    emptyNote: 'ابدأ من عروض اليوم أو الأكثر مبيعاً، وهنوصلك الطلب في نفس اليوم.',
    shopNow: 'تسوق الآن',
    startOrderForFreeShipping: (threshold: string) => `ابدأ الطلب واستمتع بتوصيل مجاني فوق ${threshold}`,
    freeShippingEarned: 'مبروك! التوصيل مجاني على طلبك 🎉',
    remainingForFreeShipping: (amount: string) => `باقي ${amount} على التوصيل المجاني`,
    minOrderBanner: (min: string, missing: string) => `الحد الأدنى للطلب ${min} — أضف بقيمة ${missing} لإتمام الطلب.`,
    minOrderToast: (min: string) => `الحد الأدنى للطلب ${min}`,
    minOrderCta: (min: string) => `الحد الأدنى ${min}`,
    subtotal: 'الإجمالي الفرعي',
    delivery: 'التوصيل',
    free: 'مجاني',
    discount: 'الخصم',
    total: 'الإجمالي',
    checkout: 'إتمام الطلب',
    discountCodeLabel: 'كود الخصم',
    discountCodePlaceholder: 'أدخل كود الخصم',
    discountApply: 'تطبيق',
    discountApplying: 'جاري التحقق...',
    discountRemove: 'إزالة',
    discountApplied: (code: string) => `تم تطبيق كود "${code}"`,
    itemUnavailable: 'هذا المنتج غير متوفر حالياً — احذفه من السلة للمتابعة',
    itemInsufficientStock: (available: number) => `الكمية المتاحة الآن ${available} فقط — عدّل الكمية للمتابعة`,
    resolveIssuesCta: 'راجع السلة قبل إتمام الطلب',
    completeYourOrder: 'أكمل طلبك'
  },

  checkout: {
    steps: ['السلة', 'البيانات', 'التأكيد'],
    deliveryInfoTitle: 'بيانات التوصيل',
    fullNameLabel: 'الاسم بالكامل',
    fullNamePlaceholder: 'مثال: أحمد محمود',
    mobileLabel: 'رقم الموبايل',
    mobilePlaceholder: '01xxxxxxxxx',
    governorateLabel: 'المحافظة',
    governoratePlaceholder: 'اختر المحافظة',
    addressLabel: 'العنوان بالتفصيل',
    addressPlaceholder: 'الشارع، رقم العمارة، الدور، الشقة',
    deliverySlotTitle: 'موعد التوصيل',
    deliverySlotFull: 'الميعاد ده امتلأ النهاردة، اختر ميعاد تاني',
    paymentTitle: 'طريقة الدفع',
    cashOnDelivery: 'الدفع عند الاستلام',
    cashOnDeliveryNote: 'كاش للمندوب وقت التسليم',
    cardPayment: 'بطاقة / محفظة إلكترونية',
    comingSoon: 'قريباً',
    codDisabledNotice: 'الدفع عند الاستلام متوقف مؤقتاً، برجاء المحاولة لاحقاً أو التواصل معنا',
    orderSummaryItemsCount: (count: number) => `${count} منتج`,
    formError: 'من فضلك اكمل الاسم ورقم الموبايل والعنوان.',
    nameError: 'الاسم مطلوب',
    mobileRequiredError: 'رقم الموبايل مطلوب',
    mobileInvalidError: 'أدخل رقم موبايل مصري صحيح مكون من 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015',
    governorateError: 'المحافظة مطلوبة',
    addressError: 'العنوان مطلوب',
    policyLink: 'سياسة الاسترجاع والاستبدال',
    savedAddressTitle: 'اختر عنوان التوصيل',
    newAddressOption: '+ عنوان جديد',
    submit: 'تأكيد الطلب وإرسال واتساب'
  },

  confirmation: {
    title: 'تم استلام طلبك 🎉',
    phoneNote: (phone: string) => `هنكلمك على ${phone} لتأكيد الطلب خلال دقائق.`,
    orderNumber: 'رقم الطلب',
    expectedDelivery: 'التسليم المتوقع',
    invoiceTitle: 'الفاتورة',
    delivery: 'التوصيل',
    totalCash: 'الإجمالي (كاش)',
    trackOrder: 'تتبع الطلب',
    backHome: 'العودة للرئيسية',
    whatsappNote: 'تم إرسال نسخة من الطلب على واتساب المتجر — تقدر تعدّل أي حاجة قبل الخروج للتوصيل.',
    guestDetailsUnavailable: 'تفاصيل الطلب متاحة مباشرة بعد إتمامه فقط. لو محتاج تتابع طلبك، تقدر تسجّل دخول لحسابك أو تكلمنا على واتساب.'
  },

  tracking: {
    mapPlaceholder: 'خريطة التتبع — عنصر بديل',
    courierName: 'محمود — مندوب التوصيل',
    courierNote: 'يبعد عنك 8 دقائق',
    callCourier: 'اتصال بمندوب التوصيل',
    statusTitle: (orderId: string) => `حالة الطلب ${orderId}`,
    steps: [
      { title: 'تم استلام الطلب', time: 'الآن' },
      { title: 'جارِ تجهيز الطلب', time: 'خلال 15 دقيقة' },
      { title: 'جاهز للتوصيل', time: 'بانتظار المندوب' },
      { title: 'خرج للتوصيل', time: 'المندوب في الطريق' },
      { title: 'تم التسليم', time: 'الدفع عند الاستلام' }
    ],
    orderCancelled: 'تم إلغاء الطلب'
  },

  account: {
    memberSince: (year: number) => `عميل منذ ${year}`,
    guestTitle: 'سجّل الدخول لعرض حسابك',
    guestNote: 'أنشئ حساب أو سجّل الدخول لمتابعة طلباتك وبياناتك المحفوظة.',
    noOrders: 'لسه معملتش أي طلب.',
    ordersLoginPrompt: 'سجّل الدخول لعرض طلباتك.',
    productsCount: (count: number) => `${count} منتج`,
    contactWhatsapp: 'تواصل معنا على واتساب',
    savedAddresses: 'عناويني المحفوظة',
    favorites: 'المفضلة',
    returnPolicy: 'سياسة الاسترجاع والاستبدال',
    settingsAndNotifications: 'الإعدادات والإشعارات',
    logout: 'تسجيل الخروج',
    reorder: 'إعادة الطلب',
    reorderAllAdded: 'تم إضافة كل منتجات الطلب للسلة بالأسعار الحالية',
    reorderSomeSkipped: (count: number) => `تم إضافة المنتجات المتاحة للسلة — ${count} منتج غير متوفر حالياً وتم تخطيه`,
    reorderNoneAvailable: 'كل منتجات هذا الطلب غير متاحة حالياً، تعذّرت إعادة الطلب',
    editProfile: 'تعديل البيانات الشخصية',
    frequentlyPurchasedTitle: 'مشترياتي المعتادة'
  },

  profile: {
    title: 'البيانات الشخصية',
    fullNameLabel: 'الاسم بالكامل',
    mobileLabel: 'رقم الموبايل',
    mobilePlaceholder: '01xxxxxxxxx',
    emailLabel: 'البريد الإلكتروني',
    emailNote: 'تغيير البريد الإلكتروني غير متاح حالياً',
    save: 'حفظ التعديلات',
    saved: 'تم حفظ التعديلات',
    saveError: 'تعذر حفظ التعديلات، تحقق من البيانات وحاول مرة أخرى',
    nameError: 'الاسم لازم يكون بين حرفين و100 حرف',
    mobileError: 'أدخل رقم موبايل مصري صحيح مكون من 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015، أو اتركه فاضي'
  },

  notifications: {
    title: 'إشعارات التنبيه',
    enableButton: 'تفعيل الإشعارات',
    disableButton: 'إيقاف الإشعارات',
    enabledNote: 'الإشعارات مفعّلة على هذا الجهاز',
    unsupported: 'الإشعارات غير مدعومة في هذا المتصفح',
    notConfigured: 'خدمة الإشعارات غير مفعّلة حالياً على المتجر',
    permissionDenied: 'تم رفض إذن الإشعارات — فعّله من إعدادات المتصفح',
    genericError: 'تعذر تفعيل الإشعارات، حاول مرة أخرى',
    orderUpdatesLabel: 'تحديثات حالة الطلب',
    promotionsLabel: 'العروض والتخفيضات'
  },

  addresses: {
    title: 'عناويني المحفوظة',
    addNew: 'إضافة عنوان جديد',
    emptyTitle: 'مفيش عناوين محفوظة لسه',
    emptyNote: 'أضف عنوان عشان تختاره بسرعة وقت الدفع.',
    labelField: 'اسم العنوان',
    labelPlaceholder: 'مثال: المنزل، الشغل',
    fullNameField: 'الاسم (اختياري)',
    mobileField: 'رقم موبايل مختلف (اختياري)',
    governorateField: 'المحافظة',
    areaField: 'المنطقة (اختياري)',
    addressField: 'العنوان بالتفصيل',
    buildingField: 'العمارة (اختياري)',
    floorField: 'الدور (اختياري)',
    apartmentField: 'الشقة (اختياري)',
    landmarkField: 'علامة مميزة (اختياري)',
    setDefault: 'اجعله الافتراضي',
    defaultBadge: 'العنوان الافتراضي',
    edit: 'تعديل',
    delete: 'حذف',
    save: 'حفظ العنوان',
    cancel: 'إلغاء',
    deleteConfirm: 'تحذف العنوان ده؟',
    governorateRequired: 'اختر المحافظة',
    addressRequired: 'أدخل العنوان بالتفصيل'
  },

  favorites: {
    title: 'المفضلة',
    emptyTitle: 'مفيش منتجات في المفضلة لسه',
    emptyNote: 'اضغط على ♡ في أي منتج عشان تضيفه هنا.',
    addedToast: 'تمت الإضافة للمفضلة',
    removedToast: 'تمت الإزالة من المفضلة',
    loginRequired: 'سجّل الدخول عشان تضيف المفضلة'
  },

  auth: {
    loginTitle: 'تسجيل الدخول',
    registerTitle: 'إنشاء حساب',
    welcome: 'مرحبًا بك',
    emailLabel: 'البريد الإلكتروني',
    emailPlaceholder: 'example@email.com',
    passwordLabel: 'كلمة المرور',
    confirmPasswordLabel: 'تأكيد كلمة المرور',
    fullNameLabel: 'الاسم بالكامل',
    fullNamePlaceholder: 'مثال: أحمد محمود',
    loginSubmit: 'تسجيل الدخول',
    registerSubmit: 'إنشاء حساب',
    noAccountYet: 'مفيش حساب لسه؟',
    createAccountLink: 'إنشاء حساب جديد',
    alreadyHaveAccount: 'عندك حساب بالفعل؟',
    loginLink: 'تسجيل الدخول',
    passwordsDontMatch: 'كلمتا المرور غير متطابقتين',
    loginCta: 'تسجيل الدخول',
    registerCta: 'إنشاء حساب',
    forgotPasswordLink: 'نسيت كلمة المرور؟',
    forgotPasswordTitle: 'استعادة كلمة المرور',
    forgotPasswordNote: 'أدخل بريدك الإلكتروني وهنبعتلك رابط لإعادة تعيين كلمة المرور.',
    forgotPasswordSubmit: 'إرسال رابط الاستعادة',
    forgotPasswordSent: 'لو الإيميل ده مسجّل عندنا، هتوصلك رسالة فيها رابط استعادة كلمة المرور خلال دقائق.',
    backToLogin: 'العودة لتسجيل الدخول',
    resetPasswordTitle: 'كلمة مرور جديدة',
    newPasswordLabel: 'كلمة المرور الجديدة',
    resetPasswordSubmit: 'حفظ كلمة المرور الجديدة',
    resetPasswordSuccess: 'تم تغيير كلمة المرور بنجاح، تقدر تسجّل دخولك دلوقتي.',
    resetPasswordInvalidLink: 'رابط الاستعادة غير صالح أو منتهي — اطلب رابط جديد.'
  },

  onboarding: {
    title: 'كل احتياجاتك.. في مكان واحد',
    subtitle: 'بقالة وألبان وخضار طازة، من علاء الدين لباب البيت خلال ساعتين.',
    deliveryFeature: 'توصيل خلال ساعتين',
    codFeature: 'الدفع عند الاستلام',
    freshFeature: 'منتجات طازة يومياً',
    start: 'ابدأ التسوق',
    skip: 'تصفح بدون تسجيل'
  },

  notFound: {
    title: 'الصفحة غير موجودة',
    backHome: 'العودة للرئيسية'
  },

  network: {
    offline: 'لا يوجد اتصال بالإنترنت',
    offlineNote: 'تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى',
    retry: 'إعادة المحاولة',
    backOnline: 'تم استعادة الاتصال بالإنترنت'
  },

  errors: {
    generic: 'حدث خطأ، حاول مرة أخرى',
    codes: {
      missing_fields: 'يرجى إدخال جميع البيانات المطلوبة',
      invalid_email: 'يرجى إدخال بريد إلكتروني صحيح',
      weak_password: 'كلمة المرور يجب ألا تقل عن 6 أحرف',
      email_taken: 'هذا البريد الإلكتروني مستخدم بالفعل',
      invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      unauthorized: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى',
      order_not_found: 'تعذر العثور على تفاصيل الطلب',
      network_error: 'تعذر الاتصال بالخادم، تحقق من اتصالك بالإنترنت',
      discount_not_found: 'كود الخصم غير صحيح',
      discount_inactive: 'كود الخصم غير مفعّل حالياً',
      discount_expired: 'انتهت صلاحية كود الخصم',
      discount_max_uses: 'تم استنفاد عدد مرات استخدام هذا الكود',
      discount_min_order: 'الطلب لم يصل الحد الأدنى المطلوب لهذا الكود',
      cod_disabled: 'الدفع عند الاستلام متوقف مؤقتاً، برجاء المحاولة لاحقاً',
      invalid_or_expired_token: 'رابط الاستعادة غير صالح أو منتهي — اطلب رابط جديد',
      invalid_request: 'يرجى إدخال جميع بيانات الطلب المطلوبة',
      customer_name_required: 'الاسم مطلوب',
      customer_mobile_required: 'رقم الموبايل مطلوب',
      customer_mobile_invalid: 'أدخل رقم موبايل مصري صحيح مكون من 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015',
      customer_governorate_required: 'المحافظة مطلوبة',
      customer_address_required: 'العنوان مطلوب',
      invalid_delivery_slot: 'يرجى اختيار موعد توصيل صحيح',
      delivery_slot_full: 'للأسف الميعاد ده امتلأ النهاردة، اختر ميعاد تاني وحاول تاني',
      payment_method_not_supported: 'طريقة الدفع غير مدعومة حالياً',
      invalid_items: 'السلة غير صالحة، يرجى إعادة المحاولة',
      invalid_discount_code: 'كود الخصم غير صحيح',
      product_not_found: 'أحد المنتجات في طلبك لم يعد متوفراً',
      product_unavailable: 'أحد المنتجات في طلبك غير متاح حالياً',
      invalid_quantity: 'الكمية المطلوبة غير صحيحة لأحد المنتجات',
      insufficient_stock: 'الكمية المطلوبة من أحد المنتجات غير متوفرة في المخزون حالياً',
      minimum_order_not_met: 'الطلب لم يصل الحد الأدنى المسموح به',
      idempotency_conflict: 'تم تعديل السلة أثناء إرسال الطلب — يرجى إعادة المحاولة'
    } as Record<string, string>,
    forCode(code: string) {
      return this.codes[code] ?? this.generic
    },
    discountMinOrder(minOrder: string) {
      return `الحد الأدنى لاستخدام هذا الكود ${minOrder}`
    }
  },

  order: {
    // مطابقة لأنواع OrderStatus الفعلية في types/models.ts
    orderStatusLabels: {
      placed: 'قيد المراجعة',
      preparing: 'جاري التجهيز',
      ready_for_delivery: 'جاهز للتوصيل',
      out_for_delivery: 'خرج للتوصيل',
      delivered: 'تم التسليم',
      cancelled: 'ملغي'
    },
    whatsappMessage: {
      newOrderFrom: (storeName: string) => `طلب جديد من ${storeName}`,
      orderNumber: (id: string) => `رقم الطلب: ${id}`,
      productsHeading: 'المنتجات:',
      subtotal: (value: string) => `الإجمالي الفرعي: ${value}`,
      discount: (code: string, value: string) => `الخصم (${code}): -${value}`,
      delivery: (value: string) => `التوصيل: ${value}`,
      total: (value: string) => `الإجمالي: ${value}`,
      name: (value: string) => `الاسم: ${value}`,
      mobile: (value: string) => `الموبايل: ${value}`,
      governorate: (value: string) => `المحافظة: ${value}`,
      address: (value: string) => `العنوان: ${value}`,
      deliverySlot: (value: string) => `موعد التوصيل: ${value}`,
      payment: 'الدفع: الدفع عند الاستلام',
      free: 'مجاني'
    }
  }
}

export type OrderStatusKey = keyof typeof ar.order.orderStatusLabels
