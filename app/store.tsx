'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import seed from '../data/seed-data.json';
import { db, isSupabaseConfigured } from './supabase';

export type Company = { id: string; name: string; sourceFile: string };
export type Product = {
    id: string;
    companyId: string;
    companyName: string;
    sku: string;
    barcode: string;
    name: string;
    openingStock: number;
    received: number;
    shipped: number;
    returned: number;
    stock: number;
    minStock: number;
    costPrice: number;
    status: string;
    sourceFile: string;
    isActive: boolean;
    alternateSkus: string[];
};
export type Movement = {
    id: string;
    companyId: string;
    productId: string;
    sku: string;
    type: 'Stock In' | 'Stock Out' | 'Return';
    qty: number;
    stockAfter: number;
    platform?: string;
    shippingPartner?: string;
    note?: string;
    date: string;
};
export type Order = {
    id: string;
    companyId: string;
    sku: string;
    platform: string;
    items: number;
    status: string;
    shippingPartner?: string;
    date: string;
    marketplaceOrderId?: string;
};
export type ReturnRow = {
    id: string;
    companyId: string;
    sku: string;
    platform: string;
    qty: number;
    condition: 'QC Pending' | 'Resellable' | 'Damaged';
    shippingPartner?: string;
    date: string;
    source?: string;
};
type Data = {
    companies: Company[];
    products: Product[];
    movements: Movement[];
    orders: Order[];
    returns: ReturnRow[];
    skuMappings: Record<string, string[]>;
};
type Ctx = Data & {
    selectedCompanyId: string;
    setSelectedCompanyId: (id: string) => void;
    selectedProducts: Product[];
    loading: boolean;
    dbError: string;
    addProduct: (p: Product) => Promise<boolean>;
    updateProduct: (p: Product) => Promise<boolean>;
    removeProduct: (id: string) => Promise<boolean>;
    adjustStock: (
        id: string,
        qty: number,
        type: 'Stock In' | 'Stock Out' | 'Return',
        platform?: string,
        shippingPartner?: string,
        note?: string
    ) => Promise<boolean>;
    addOrder: (o: Omit<Order, 'id'>) => Promise<boolean>;
    addReturn: (r: Omit<ReturnRow, 'id'>) => Promise<boolean>;
    processReturn: (
        id: string,
        condition: 'Resellable' | 'Damaged'
    ) => Promise<boolean>;
    resetData: () => void;
};

const Ctx = createContext<Ctx | null>(null);
const initial = {
    ...seed,
    products: seed.products.map((p, index) => ({
        ...p,
        costPrice: Number((p as typeof p & { costPrice?: number }).costPrice ?? (200 + ((index * 137) % 801))),
        isActive: true,
        alternateSkus: [...(p.alternateSkus || [])],
    })),
    skuMappings: {},
} as Data;
function cloneInitial(): Data {
    return JSON.parse(JSON.stringify(initial));
}
const status = (stock: number, min: number) =>
    stock === 0 ? 'OUT OF STOCK' : stock <= min ? 'LOW STOCK' : 'OK';

const mapCompany = (r: Record<string, unknown>): Company => ({
    id: String(r.id),
    name: String(r.name || ''),
    sourceFile: String(r.source_file || ''),
});

const mapProduct = (r: Record<string, unknown>, c: Company): Product => {
    const opening = Number(r.opening_stock || 0),
        received = Number(r.received || 0),
        returned = Number(r.returned || 0),
        shipped = Number(r.shipped || 0);
    const stock = opening + received + returned - shipped;
    const minStock = Number(r.low_stock_limit || 0);
    return {
        id: String(r.id),
        companyId: String(r.company_id),
        companyName: c.name,
        sku: String(r.sku || ''),
        barcode: String(r.barcode || ''),
        name: String(r.product_name || ''),
        openingStock: opening,
        received,
        shipped,
        returned,
        stock,
        minStock,
        costPrice: Number(r.cost_price || 0),
        status: status(stock, minStock),
        sourceFile: c.sourceFile,
        isActive: r.is_active !== false,
        alternateSkus: [],
    };
};

const mapMovement = (
    r: Record<string, unknown>,
    products: Product[]
): Movement => {
    const productId = String(r.product_id);
    const p = products.find(x => x.id === productId);
    const rawType = String(r.movement_type);
    const type: Movement['type'] =
        rawType === 'stock_in'
            ? 'Stock In'
            : rawType === 'stock_out'
              ? 'Stock Out'
              : 'Return';
    const quantity = Number(r.quantity || 0);
    return {
        id: String(r.id),
        companyId: String(r.company_id),
        productId,
        sku: p?.sku || '',
        type,
        qty: type === 'Stock Out' ? -quantity : quantity,
        stockAfter: 0,
        platform: String(r.platform || ''),
        shippingPartner: String(r.shipping_partner || ''),
        note: String(r.note || ''),
        date: String(r.created_at),
    };
};

const mapOrder = (r: Record<string, unknown>, products: Product[]): Order => ({
    id: String(r.id),
    companyId: String(r.company_id),
    sku: products.find(p => p.id === String(r.product_id))?.sku || '',
    platform: String(r.platform || ''),
    items: Number(r.quantity || 0),
    status: 'Recorded',
    shippingPartner: String(r.shipping_partner || ''),
    date: String(r.order_date),
    marketplaceOrderId: r.marketplace_order_id
        ? String(r.marketplace_order_id)
        : undefined,
});

const mapReturn = (
    r: Record<string, unknown>,
    products: Product[]
): ReturnRow => ({
    id: String(r.id),
    companyId: String(r.company_id),
    sku: products.find(p => p.id === String(r.product_id))?.sku || '',
    platform: String(r.platform || ''),
    qty: Number(r.quantity || 0),
    condition:
        String(r.qc_status) === 'pending'
            ? 'QC Pending'
            : String(r.qc_status) === 'resellable'
              ? 'Resellable'
              : 'Damaged',
    shippingPartner: String(r.shipping_partner || ''),
    date: String(r.return_date),
    source: String(r.source_file || r.source_status || 'Supabase'),
});


export function resolveProductBySku(products: Product[], companyId: string, rawSku: string): Product | null {
    const sku = rawSku.trim();
    if (!sku) return null;

    // 1) Exact SKU first. This is important because the master can contain
    // legitimate SKUs that differ only by case.
    const exact = products.filter(p =>
        p.companyId === companyId &&
        (p.sku.trim() === sku || p.alternateSkus.some(a => a.trim() === sku))
    );
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;

    // 2) Case-insensitive fallback only when unambiguous.
    const folded = sku.toLowerCase();
    const fallback = products.filter(p =>
        p.companyId === companyId &&
        (p.sku.trim().toLowerCase() === folded ||
            p.alternateSkus.some(a => a.trim().toLowerCase() === folded))
    );
    return fallback.length === 1 ? fallback[0] : null;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
    const [data, setData] = useState<Data>({
        companies: [],
        products: [],
        movements: [],
        orders: [],
        returns: [],
        skuMappings: {},
    });
    const [selectedCompanyId, setSelectedCompanyId] = useState('all');
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [dbError, setDbError] = useState('');

    const refresh = async () => {
        if (!isSupabaseConfigured()) {
            setData(cloneInitial());
            setDbError('Supabase is not configured.');
            setLoading(false);
            setReady(true);
            return;
        }
        try {
            setLoading(true);
            setDbError('');
            const [cs, ps, ms, os, rs, kms] = await Promise.all([
                db.select<Record<string, unknown>>(
                    'companies',
                    'select=*&order=name.asc'
                ),
                db.select<Record<string, unknown>>(
                    'products',
                    'select=*&is_active=eq.true&order=sku.asc'
                ),
                db.select<Record<string, unknown>>(
                    'inventory_movements',
                    'select=*&order=created_at.desc&limit=1000'
                ),
                db.select<Record<string, unknown>>(
                    'orders',
                    'select=*&order=order_date.desc&limit=1000'
                ),
                db.select<Record<string, unknown>>(
                    'returns',
                    'select=*&order=return_date.desc&limit=1000'
                ),
                db.select<Record<string, unknown>>(
                    'product_sku_mappings',
                    'select=*&order=created_at.asc'
                ),
            ]);
            const companies = cs.map(mapCompany);
            const products = ps.map(r =>
                mapProduct(
                    r,
                    companies.find(c => c.id === String(r.company_id)) || {
                        id: String(r.company_id),
                        name: 'Unknown',
                        sourceFile: '',
                    }
                )
            );
            const skuMappings: Record<string, string[]> = {};
            for (const r of kms) {
                const pid = String(r.product_id);
                const value = String(r.marketplace_sku || '').trim();
                if (!value) continue;
                (skuMappings[pid] ||= []).push(value);
            }
            for (const p of products) p.alternateSkus = skuMappings[p.id] || [];
            const movements = ms.map(r => mapMovement(r, products));
            const running = new Map(products.map(p => [p.id, p.stock]));
            for (const m of movements) {
                m.stockAfter = running.get(m.productId) || 0;
                running.set(
                    m.productId,
                    (running.get(m.productId) || 0) - m.qty
                );
            }
            setData({
                companies,
                products,
                movements,
                orders: os.map(r => mapOrder(r, products)),
                returns: rs.map(r => mapReturn(r, products)),
                skuMappings,
            });
        } catch (e: unknown) {
            setDbError(
                e instanceof Error ? e.message : 'Could not load Supabase data.'
            );
        } finally {
            setLoading(false);
            setReady(true);
        }
    };

    useEffect(() => {
        void refresh();
        const saved =
            typeof window !== 'undefined'
                ? localStorage.getItem('ov-stock-company')
                : null;
        if (saved) setSelectedCompanyId(saved);
    }, []);

    useEffect(() => {
        if (ready && typeof window !== 'undefined')
            localStorage.setItem('ov-stock-company', selectedCompanyId);
    }, [selectedCompanyId, ready]);

    useEffect(() => {
        if (!ready || !isSupabaseConfigured()) return;
        const timer = setInterval(() => {
            void refresh();
        }, 8000);
        return () => clearInterval(timer);
    }, [ready]);

    const selectedProducts = useMemo(
        () =>
            selectedCompanyId === 'all'
                ? data.products
                : data.products.filter(p => p.companyId === selectedCompanyId),
        [data.products, selectedCompanyId]
    );

    const api = useMemo<Ctx>(
        () => ({
            ...data,
            selectedCompanyId,
            setSelectedCompanyId,
            selectedProducts,
            loading,
            dbError,

            addProduct: async p => {
                try {
                    const rows = await db.insert<Record<string, unknown>>(
                        'products',
                        {
                            company_id: p.companyId,
                            sku: p.sku.trim(),
                            product_name: p.name.trim(),
                            barcode: p.barcode.trim() || null,
                            opening_stock: p.openingStock,
                            received: 0,
                            shipped: 0,
                            returned: 0,
                            low_stock_limit: p.minStock,
                            cost_price: p.costPrice,
                        }
                    );
                    if (!rows?.[0]) throw new Error('Product was not saved.');
                    const productId = String(rows[0].id);
                    const alternateSkus = [...new Set((p.alternateSkus || []).map(x => x.trim()).filter(Boolean))];
                    if (alternateSkus.length) {
                        await db.insert('product_sku_mappings', alternateSkus.map(marketplace_sku => ({
                            company_id: p.companyId, product_id: productId, platform: 'Flipkart', marketplace_sku
                        })));
                    }
                    await refresh();
                    return true;
                } catch (e: unknown) {
                    alert(
                        e instanceof Error
                            ? e.message
                            : 'Failed to add product.'
                    );
                    return false;
                }
            },

            updateProduct: async p => {
                try {
                    const rows = await db.update<Record<string, unknown>>(
                        'products',
                        `id=eq.${encodeURIComponent(p.id)}`,
                        {
                            sku: p.sku.trim(),
                            product_name: p.name.trim(),
                            barcode: p.barcode.trim() || null,
                            low_stock_limit: p.minStock,
                            cost_price: p.costPrice,
                        }
                    );
                    if (!rows?.[0]) throw new Error('Product was not saved.');
                    await db.remove('product_sku_mappings', `product_id=eq.${encodeURIComponent(p.id)}`);
                    const alternateSkus = [...new Set((p.alternateSkus || []).map(x => x.trim()).filter(Boolean))];
                    if (alternateSkus.length) {
                        await db.insert('product_sku_mappings', alternateSkus.map(marketplace_sku => ({
                            company_id: p.companyId, product_id: p.id, platform: 'Flipkart', marketplace_sku
                        })));
                    }
                    await refresh();
                    return true;
                } catch (e: unknown) {
                    alert(
                        e instanceof Error
                            ? e.message
                            : 'Failed to update product.'
                    );
                    return false;
                }
            },

            removeProduct: async id => {
                if (
                    !confirm(
                        'Archive this product? Historical orders and stock movements will be preserved.'
                    )
                )
                    return false;
                try {
                    const rows = await db.update<Record<string, unknown>>(
                        'products',
                        `id=eq.${encodeURIComponent(id)}`,
                        { is_active: false }
                    );
                    if (!rows?.[0])
                        throw new Error('Product could not be archived.');
                    await refresh();
                    return true;
                } catch (e: unknown) {
                    alert(
                        e instanceof Error
                            ? e.message
                            : 'Product could not be archived.'
                    );
                    return false;
                }
            },

            adjustStock: async (
                id,
                qty,
                type,
                platform = '',
                shippingPartner = '',
                note = ''
            ) => {
                if (type === 'Return') return false;
                const p = data.products.find(x => x.id === id);
                if (
                    !p ||
                    !Number.isInteger(qty) ||
                    qty <= 0 ||
                    (type === 'Stock Out' && qty > p.stock)
                )
                    return false;
                try {
                    await db.rpc('adjust_stock', {
                        p_product_id: id,
                        p_quantity: qty,
                        p_movement_type: type,
                        p_platform: platform || null,
                        p_shipping_partner: shippingPartner || null,
                        p_note: note || null,
                    });
                    await refresh();
                    return true;
                } catch (e: unknown) {
                    const message =
                        e instanceof Error ? e.message : 'Stock update failed.';
                    setDbError(message);
                    alert(`${message}\n\nNothing was changed.`);
                    await refresh();
                    return false;
                }
            },

            addOrder: async o => {
                const p = resolveProductBySku(data.products, o.companyId, o.sku);
                if (
                    !p ||
                    !Number.isInteger(o.items) ||
                    o.items < 1 ||
                    o.items > p.stock
                ) {
                    if (p && o.items > p.stock)
                        alert('Order quantity cannot exceed available stock.');
                    return false;
                }
                try {
                    await db.rpc('create_order', {
                        p_company_id: o.companyId,
                        p_product_id: p.id,
                        p_platform: o.platform,
                        p_quantity: o.items,
                        p_shipping_partner: o.shippingPartner || null,
                        p_order_date: o.date,
                        p_marketplace_order_id:
                            o.marketplaceOrderId?.trim() || null,
                    });
                    await refresh();
                    return true;
                } catch (e: unknown) {
                    alert(
                        e instanceof Error ? e.message : 'Failed to save order.'
                    );
                    await refresh();
                    return false;
                }
            },

            addReturn: async r => {
                const p = resolveProductBySku(data.products, r.companyId, r.sku);
                if (!p || !Number.isInteger(r.qty) || r.qty < 1) return false;
                try {
                    await db.insert('returns', {
                        company_id: r.companyId,
                        product_id: p.id,
                        platform: r.platform,
                        quantity: r.qty,
                        qc_status: 'pending',
                        shipping_partner: r.shippingPartner || null,
                        return_date: r.date,
                    });
                    await refresh();
                    return true;
                } catch (e: unknown) {
                    alert(
                        e instanceof Error
                            ? e.message
                            : 'Failed to save return.'
                    );
                    return false;
                }
            },

            processReturn: async (id, condition) => {
                try {
                    await db.rpc('process_return', {
                        p_return_id: id,
                        p_condition:
                            condition === 'Resellable'
                                ? 'resellable'
                                : 'damaged',
                    });
                    await refresh();
                    return true;
                } catch (e: unknown) {
                    alert(
                        e instanceof Error
                            ? e.message
                            : 'Return processing failed.'
                    );
                    await refresh();
                    return false;
                }
            },

            resetData: () =>
                alert(
                    'Supabase is the source of truth. Cloud data reset is disabled to prevent accidental inventory loss.'
                ),
        }),
        [data, selectedCompanyId, selectedProducts, loading, dbError]
    );

    return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore() {
    const x = useContext(Ctx);
    if (!x) throw new Error('useStore must be inside StoreProvider');
    return x;
}
