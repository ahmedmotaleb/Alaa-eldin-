// إدارة وسوم <head> الخاصة بمحركات البحث/معاينات المشاركة (title, description, canonical,
// Open Graph, Twitter Card) — مختلفة تماماً عن pageTitleStore (اللي بيتحكم في عنوان الهيدر
// الظاهر جوه الواجهة نفسها، مش عنوان تبويب المتصفح ولا وسوم الميتا). كل الروابط المطلقة
// بتتبني من window.location.origin وقت التشغيل — يعني لو المتجر اتنقل لدومين مخصص، الروابط
// بتتظبط تلقائياً من غير أي إعداد إضافي وقت البناء.
export interface PageMetaInput {
  title: string
  description: string
  path: string
  image?: string
  type?: 'website' | 'product' | 'article'
}

function setMetaTag(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setLinkTag(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

export function setPageMeta({ title, description, path, image, type = 'website' }: PageMetaInput) {
  document.title = title
  setMetaTag('name', 'description', description)
  const url = `${window.location.origin}${path}`
  setLinkTag('canonical', url)
  setMetaTag('property', 'og:title', title)
  setMetaTag('property', 'og:description', description)
  setMetaTag('property', 'og:type', type)
  setMetaTag('property', 'og:url', url)
  setMetaTag('name', 'twitter:card', image ? 'summary_large_image' : 'summary')
  setMetaTag('name', 'twitter:title', title)
  setMetaTag('name', 'twitter:description', description)
  if (image) {
    setMetaTag('property', 'og:image', image)
    setMetaTag('name', 'twitter:image', image)
  }
}

const PRODUCT_JSONLD_ID = 'product-jsonld'

export interface ProductJsonLdInput {
  name: string
  description: string
  image?: string
  brand?: string
  price: number
  currency: string
  available: boolean
  path: string
}

export function setProductJsonLd(product: ProductJsonLdInput) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    ...(product.image ? { image: [product.image] } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: product.currency,
      price: product.price,
      availability: product.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${window.location.origin}${product.path}`
    }
  }

  let script = document.getElementById(PRODUCT_JSONLD_ID) as HTMLScriptElement | null
  if (!script) {
    script = document.createElement('script')
    script.id = PRODUCT_JSONLD_ID
    script.type = 'application/ld+json'
    document.head.appendChild(script)
  }
  script.textContent = JSON.stringify(data)
}

export function clearProductJsonLd() {
  document.getElementById(PRODUCT_JSONLD_ID)?.remove()
}
