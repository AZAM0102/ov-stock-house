import { NextRequest, NextResponse } from 'next/server';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

async function supabase<T = any>(path: string): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase environment variables are missing.');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Supabase request failed (${res.status})`);
  return res.json();
}

function esc(value: string) {
  return encodeURIComponent(value);
}

function normalize(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isSkuLike(value: string) {
  const n = normalize(value);
  return n.length >= 5 && /[A-Z]/.test(n) && /\d/.test(n);
}

function detectIntent(message: string) {
  const m = message.toLowerCase();
  return {
    lowStock: /low stock|low-stock|kam stock|minimum|reorder|out of stock|stock khatam|khatam/.test(m),
    orders: /order|orders|sale|sales|shipped|dispatch|flipkart|amazon|meesho/.test(m),
    returns: /return|returns|qc|resell|damaged/.test(m),
    history: /history|movement|movements|kab|recent|last|received|stock in|stock out/.test(m),
    summary: /total|summary|overview|kitna stock|stock kitna|inventory|dashboard|overall/.test(m),
  };
}

async function getContext(message: string, companyId: string, companyName: string) {
  const intent = detectIntent(message);
  const companyFilter = companyId && companyId !== 'all' ? `&company_id=eq.${esc(companyId)}` : '';

  // Products are the smallest and most important dataset. Keep the query bounded.
  const products = await supabase<any[]>(
    `products?select=id,company_id,sku,product_name,barcode,opening_stock,received,shipped,returned,low_stock_limit&order=sku.asc&limit=500${companyFilter}`
  );

  const lower = message.toLowerCase();
  const matchingProducts = products
    .map(p => ({
      ...p,
      score: [p.sku, p.barcode, p.product_name]
        .filter(Boolean)
        .some((v: string) => lower.includes(v.toLowerCase())) ? 10 :
        [p.sku, p.barcode, p.product_name]
          .filter(Boolean)
          .some((v: string) => v.toLowerCase().includes(lower) || lower.includes(v.toLowerCase())) ? 5 : 0,
    }))
    .filter(p => p.score > 0)
    .slice(0, 12);

  // Also catch SKU-like fragments such as "kil-m1" or "scl-m1-nbl".
  const tokens = message.toUpperCase().match(/[A-Z0-9][A-Z0-9._-]{3,}/g) || [];
  const skuTokens = tokens.filter(isSkuLike);
  if (skuTokens.length) {
    const tokenMatches = products.filter(p => skuTokens.some(t => normalize(p.sku).includes(normalize(t)) || normalize(t).includes(normalize(p.sku))));
    for (const p of tokenMatches.slice(0, 12)) if (!matchingProducts.some(x => x.id === p.id)) matchingProducts.push({ ...p, score: 8 });
  }

  const selected = matchingProducts.length ? matchingProducts : products;
  const productContext = selected.slice(0, 40).map(p => ({
    company: p.company_id,
    sku: p.sku,
    name: p.product_name,
    barcode: p.barcode || '',
    stock: (p.opening_stock || 0) + (p.received || 0) + (p.returned || 0) - (p.shipped || 0),
    opening: p.opening_stock || 0,
    received: p.received || 0,
    shipped: p.shipped || 0,
    returned: p.returned || 0,
    lowStockLimit: p.low_stock_limit || 0,
  }));

  const context: any = {
    activeCompany: companyName || 'All Companies',
    sellerAliases: { NUME: ['Seller Solutions'] },
    matchedProducts: productContext,
  };

  if (intent.lowStock || intent.summary) {
    context.lowStockProducts = products
      .map(p => ({ sku: p.sku, name: p.product_name, stock: (p.opening_stock || 0) + (p.received || 0) + (p.returned || 0) - (p.shipped || 0), limit: p.low_stock_limit || 0 }))
      .filter(p => p.stock <= p.limit)
      .slice(0, 100);
    context.summary = {
      productCount: products.length,
      totalStock: products.reduce((sum, p) => sum + (p.opening_stock || 0) + (p.received || 0) + (p.returned || 0) - (p.shipped || 0), 0),
      outOfStock: products.filter(p => ((p.opening_stock || 0) + (p.received || 0) + (p.returned || 0) - (p.shipped || 0)) === 0).length,
    };
  }

  if (intent.orders) {
    const orders = await supabase<any[]>(`orders?select=company_id,product_id,platform,quantity,shipping_partner,order_date&order=order_date.desc&limit=120${companyFilter}`);
    const productById = new Map(products.map(p => [p.id, p.sku]));
    context.recentOrders = orders.map(o => ({ sku: productById.get(o.product_id) || '', platform: o.platform, qty: o.quantity, shippingPartner: o.shipping_partner || '', date: o.order_date }));
  }

  if (intent.returns) {
    const returns = await supabase<any[]>(`returns?select=company_id,product_id,platform,quantity,qc_status,shipping_partner,return_date&order=return_date.desc&limit=120${companyFilter}`);
    const productById = new Map(products.map(p => [p.id, p.sku]));
    context.recentReturns = returns.map(r => ({ sku: productById.get(r.product_id) || '', platform: r.platform, qty: r.quantity, qc: r.qc_status, shippingPartner: r.shipping_partner || '', date: r.return_date }));
  }

  if (intent.history) {
    const movements = await supabase<any[]>(`inventory_movements?select=company_id,product_id,movement_type,quantity,platform,shipping_partner,note,created_at&order=created_at.desc&limit=150${companyFilter}`);
    const productById = new Map(products.map(p => [p.id, p.sku]));
    context.recentMovements = movements.map(m => ({ sku: productById.get(m.product_id) || '', type: m.movement_type, qty: m.quantity, platform: m.platform || '', shippingPartner: m.shipping_partner || '', note: m.note || '', date: m.created_at }));
  }

  return context;
}

export async function POST(req: NextRequest) {
  try {
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Gemini API key is not configured. Add GEMINI_API_KEY in Vercel environment variables.' }, { status: 500 });
    const body = await req.json();
    const message = String(body?.message || '').trim();
    const companyId = String(body?.companyId || 'all');
    const companyName = String(body?.companyName || (companyId === 'all' ? 'All Companies' : 'Selected Company'));
    const history = Array.isArray(body?.history) ? body.history.slice(-8) : [];
    if (!message) return NextResponse.json({ error: 'Message is required.' }, { status: 400 });

    const context = await getContext(message, companyId, companyName);
    const prompt = `You are OV Stock House AI Assistant, a friendly human-like inventory assistant for an Indian ecommerce seller.\n\nRules:\n- Answer in natural Hinglish unless the user clearly asks in English.\n- Be concise, practical and confident, like a helpful teammate.\n- Use ONLY the supplied inventory context for stock/order/return facts. Never invent numbers.\n- Company + SKU is the product identity. Never mix companies.\n- If activeCompany is All Companies, clearly name the company for SKU-specific answers.\n- NUME is also known as Seller Solutions; treat these as the same seller alias.\n- Internal SKU values must be preserved exactly as supplied.\n- If the context does not contain enough information, say that clearly and ask for the SKU/company/date needed.\n- You are read-only in this version: never claim that you changed stock or created an order.\n\nActive company: ${companyName}\n\nInventory context:\n${JSON.stringify(context)}\n\nRecent conversation:\n${JSON.stringify(history)}\n\nUser question: ${message}`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 500 },
      }),
      cache: 'no-store',
    });
    const data = await geminiRes.json();
    if (!geminiRes.ok) return NextResponse.json({ error: data?.error?.message || 'Gemini request failed.' }, { status: 502 });
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('').trim();
    if (!text) return NextResponse.json({ error: 'Gemini returned an empty response.' }, { status: 502 });
    return NextResponse.json({ text });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Assistant request failed.' }, { status: 500 });
  }
}
