import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Leaf, MessageCircle, Minus, Plus, ShoppingBag, Truck, ShieldCheck, X, UtensilsCrossed } from 'lucide-react'
import { products } from '../lib/business'

export function Storefront() {
  const [company, setCompany] = useState('FreshRoute')
  const [phone, setPhone] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [checkout, setCheckout] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const checkoutDialog = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!checkout) return
    const previous = document.activeElement as HTMLElement
    checkoutDialog.current?.querySelector<HTMLElement>('button, input')?.focus()
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') setCheckout(false)
      if (event.key !== 'Tab') return
      const elements = checkoutDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea')
      if (!elements?.length) return
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [checkout])
  useEffect(() => {
    fetch('/api/catalog').then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setCompany(data.company); setPhone(data.whatsapp); setLoaded(true)
    }).catch(() => setError('Business contact details are temporarily unavailable. Please try again later.'))
  }, [])
  const count = Object.values(cart).reduce((total, quantity) => total + quantity, 0)
  function change(name: string, amount: number) {
    setCart(current => ({ ...current, [name]: Math.max(0, (current[name] || 0) + amount) }))
  }
  function order(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!phone || !count) return
    const values = new FormData(event.currentTarget)
    const items = products.filter(product => cart[product.name]).map(product => `${product.name}: ${cart[product.name]} ${product.name === 'Eggs' ? 'trays (30 eggs)' : 'kg'}`).join('\n')
    const message = `Hello ${company}, I'd like a quotation.\n\n${items}\n\nName / business: ${values.get('name')}\nCustomer type: ${values.get('type')}\nDelivery address: ${values.get('address')}\nRequested date: ${values.get('date')}\nNotes / cuts: ${values.get('notes')}\n\nPlease confirm availability, final weight, price and delivery charges.`
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }
  return <div className="storefront">
    <header className="store-header"><a className="brand" href="/shop"><span className="brand-icon"><Leaf size={23} /></span>{company}<span className="brand-dot">.</span></a><nav><a href="#products">Our products</a><a href="#business">For businesses</a><a className="store-admin" href="/"><ArrowLeft size={15} /> Operations</a></nav><button className="primary" onClick={() => setCheckout(true)}><ShoppingBag size={17} /> Your order {count > 0 && <span className="cart-count">{count}</span>}</button></header>
    <main>
      <section className="store-hero"><div><span className="eyebrow"><span className="live-dot" /> FROM FARM TO YOUR KITCHEN</span><h1>Good food starts<br />with <em>good sourcing.</em></h1><p>Fresh meat, seafood and eggs. A dependable supply partner for restaurants, caterers and everyday kitchens.</p><a className="primary large" href="#products">Explore our products <ArrowRight size={18} /></a><div className="hero-tags"><span><Check size={15} /> Wholesale & retail</span><span><Check size={15} /> Custom cuts</span><span><Check size={15} /> WhatsApp ordering</span></div></div><div className="farm-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><span className="art-caption">FARM SOURCED.<br />KITCHEN READY.</span><div className="produce-main">🥩</div><div className="produce-float produce-one">🍗</div><div className="produce-float produce-two">🥚</div><div className="produce-float produce-three">🦐</div><span className="art-seal"><Leaf size={19} /> A FRESHER<br />WAY FORWARD</span></div></section>
      <section className="store-promises"><div><Leaf /><span><strong>Direct relationships</strong>Farmer-to-processing sourcing</span></div><div><ShieldCheck /><span><strong>Thoughtful processing</strong>Batch-led quality workflows</span></div><div><Truck /><span><strong>Local distribution</strong>Wholesale, retail & mobile outlets</span></div></section>
      <section id="products" className="store-products"><div className="section-heading"><div><span className="eyebrow">THE EVERYDAY ESSENTIALS</span><h2>Fresh choices. For every kitchen.</h2></div><p>Choose your quantities. We confirm today’s<br />availability and pricing over WhatsApp.</p></div><div className="catalog-grid">{products.map(product => <article className="catalog-card" key={product.name}><div className="catalog-art" style={{ background: product.color }}><span>{product.emoji}</span><span className="cut-label">FRESH SELECTION</span></div><div className="catalog-copy"><h3>{product.name}</h3><p>{product.description}</p><div className="product-quantity"><span>By the {product.name === 'Eggs' ? 'tray · 30 eggs' : 'kg'}</span>{cart[product.name] ? <div className="stepper"><button aria-label={`Remove one ${product.name}`} onClick={() => change(product.name, -1)}><Minus size={14} /></button><b>{cart[product.name]}</b><button aria-label={`Add one ${product.name}`} onClick={() => change(product.name, 1)}><Plus size={14} /></button></div> : <button className="outline small" onClick={() => change(product.name, 1)}>Add <Plus size={14} /></button>}</div></div></article>)}</div><p className="muted fine-print">Quantities are requests, not confirmed orders. Prices, actual weight, service area and delivery charges are confirmed before fulfilment.</p></section>
      <section id="business" className="business-band"><div><span className="eyebrow">YOUR KITCHEN. OUR COMMITMENT.</span><h2>A supplier that understands<br />your business.</h2><p>From a neighbourhood restaurant to a large catering event, discuss scheduled supply, preferred cuts and volume requirements directly with our team.</p><button className="primary" onClick={() => setCheckout(true)}>Discuss your requirements <MessageCircle size={17} /></button></div><div className="business-benefits"><p><UtensilsCrossed /><span><strong>Restaurants & cloud kitchens</strong>Plan daily requirements and consistent portions.</span></p><p><Truck /><span><strong>Caterers & event kitchens</strong>Coordinate event quantities and delivery windows.</span></p><p><ShoppingBag /><span><strong>Retail & neighbourhoods</strong>Shop through our retail and mobile outlets.</span></p><div className="roadmap-note">On the roadmap <ArrowRight size={14} /><strong>Restaurant & catering software</strong><span>Purchasing, recipes, kitchen stock and event costing. Register your interest in your WhatsApp message.</span></div></div></section>
    </main><footer className="store-footer"><span className="brand"><Leaf size={22} />{company}.</span><span>Better sourcing. Stronger kitchens.</span><a href="/">Team operations <ArrowRight size={15} /></a></footer>
    {checkout && <div className="modal-backdrop" onClick={() => setCheckout(false)}><section ref={checkoutDialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" aria-label="Close order" onClick={() => setCheckout(false)}><X size={20} /></button><span className="eyebrow">LET’S TALK FRESH</span><h2 id="checkout-title">Your WhatsApp request</h2><p className="muted">Send a quotation request directly to our team. Nothing is charged online.</p>{count ? <div className="cart-summary">{products.filter(product => cart[product.name]).map(product => <div key={product.name}><span>{product.emoji} {product.name}</span><div className="stepper"><button aria-label={`Remove ${product.name}`} onClick={() => change(product.name, -1)}><Minus size={14} /></button><strong>{cart[product.name]} {product.name === 'Eggs' ? 'trays' : 'kg'}</strong><button aria-label={`Add ${product.name}`} onClick={() => change(product.name, 1)}><Plus size={14} /></button></div></div>)}</div> : <div className="empty-state">Add products from the catalog to start your request.</div>}<form onSubmit={order}><label>Name / business<input name="name" required maxLength={120} placeholder="Your name or restaurant" /></label><label>Customer type<select name="type"><option>Restaurant</option><option>Caterer</option><option>Retail customer</option><option>Other business</option></select></label><label>Delivery address<textarea name="address" required maxLength={500} rows={2} /></label><label>Requested delivery date<input name="date" type="date" required min={new Date().toISOString().slice(0, 10)} /></label><label>Cuts, timings or other requirements<textarea name="notes" rows={2} maxLength={800} /></label>{error && <p className="form-error" role="alert">{error}</p>}{loaded && !phone && <p className="form-error">WhatsApp ordering is awaiting the business number. An administrator can connect it in Business settings.</p>}<button className="primary full" disabled={!phone || !count}><MessageCircle size={18} /> Continue to WhatsApp</button></form></section></div>}
  </div>
}
