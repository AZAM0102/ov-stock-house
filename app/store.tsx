'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import seed from '../data/seed-data.json';
import { db, isSupabaseConfigured } from './supabase';

export type Company = {
  id: string;
  name: string;
  sourceFile: string;
};

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
  status: string;
  sourceFile: string;
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
};

type Ctx = Data & {
  selectedCompanyId: string;
  setSelectedCompanyId: (id: string) => void;
  selectedProducts: Product[];
  loading: boolean;
  dbError: string;

  addProduct: (p: Product) => void;
  updateProduct: (p: Product) => void;
  removeProduct: (id: string) => void;

  adjustStock: (
    id: string,
    qty: number,
    type: 'Stock In' | 'Stock Out' | 'Return',
    platform?: string,
    shippingPartner?: string,
    note?: string
  ) => boolean;

  addOrder: (o: Omit<Order, 'id'>) => void;
  addReturn: (r: Omit<ReturnRow, 'id'>) => void;

  processReturn: (
    id: string,
    condition: 'Resellable' | 'Damaged'
  ) => boolean;

  resetData: () => void;
};

const Ctx = createContext<Ctx | null>(null);

const initial = seed as Data;

function cloneInitial(): Data {
  return JSON.parse(JSON.stringify(initial));
}

const status = (stock: number, min: number) => {
  if (stock === 0) return 'OUT OF STOCK';
  if (stock <= min) return 'LOW STOCK';
  return 'OK';
};

const mapCompany = (r: any): Company => ({
  id: r.id,
  name: r.name,
  sourceFile: r.source_file || '',
});

const mapProduct = (r: any, c: Company): Product => {
  const stock =
    (r.opening_stock || 0) +
    (r.received || 0) +
    (r.returned || 0) -
    (r.shipped || 0);

  return {
    id: r.id,
    companyId: r.company_id,
    companyName: c.name,
    sku: r.sku,
    barcode: r.barcode || '',
    name: r.product_name || '',
    openingStock: r.opening_stock || 0,
    received: r.received || 0,
    shipped: r.shipped || 0,
    returned: r.returned || 0,
    stock,
    minStock: r.low_stock_limit || 0,
    status: status(stock, r.low_stock_limit || 0),
    sourceFile: c.sourceFile,
  };
};

const mapMovement = (
  r: any,
  products: Product[]
): Movement => {
  const p = products.find(
    (x: Product) => x.id === r.product_id
  );

  const type =
    r.movement_type === 'stock_in'
      ? 'Stock In'
      : r.movement_type === 'stock_out'
        ? 'Stock Out'
        : 'Return';

  const signed =
    type === 'Stock Out'
      ? -r.quantity
      : r.quantity;

  return {
    id: r.id,
    companyId: r.company_id,
    productId: r.product_id,
    sku: p?.sku || '',
    type,
    qty: signed,
    stockAfter: 0,
    platform: r.platform || '',
    shippingPartner: r.shipping_partner || '',
    note: r.note || '',
    date: r.created_at,
  };
};

const mapOrder = (
  r: any,
  products: Product[]
): Order => ({
  id: r.id,
  companyId: r.company_id,
  sku:
    products.find(
      (p: Product) => p.id === r.product_id
    )?.sku || '',
  platform: r.platform,
  items: r.quantity,
  status: 'Recorded',
  shippingPartner: r.shipping_partner || '',
  date: r.order_date,
});

const mapReturn = (
  r: any,
  products: Product[]
): ReturnRow => ({
  id: r.id,
  companyId: r.company_id,
  sku:
    products.find(
      (p: Product) => p.id === r.product_id
    )?.sku || '',
  platform: r.platform,
  qty: r.quantity,
  condition:
    r.qc_status === 'pending'
      ? 'QC Pending'
      : r.qc_status === 'resellable'
        ? 'Resellable'
        : 'Damaged',
  shippingPartner: r.shipping_partner || '',
  date: r.return_date,
  source: 'Supabase',
});

export function StoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [data, setData] = useState<Data>({
    companies: [],
    products: [],
    movements: [],
    orders: [],
    returns: [],
  });

  const [selectedCompanyId, setSelectedCompanyId] =
    useState('all');

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

      const [
        cs,
        ps,
        ms,
        os,
        rs,
      ] = await Promise.all([
        db.select<any>(
          'companies',
          'select=*&order=name.asc'
        ),

        db.select<any>(
          'products',
          'select=*&order=sku.asc'
        ),

        db.select<any>(
          'inventory_movements',
          'select=*&order=created_at.desc&limit=1000'
        ),

        db.select<any>(
          'orders',
          'select=*&order=order_date.desc&limit=1000'
        ),

        db.select<any>(
          'returns',
          'select=*&order=return_date.desc&limit=1000'
        ),
      ]);

      const companies: Company[] = cs.map(
        (r: any) => mapCompany(r)
      );

      const products: Product[] = ps.map(
        (r: any) =>
          mapProduct(
            r,
            companies.find(
              (c: Company) =>
                c.id === r.company_id
            ) || {
              id: r.company_id,
              name: 'Unknown',
              sourceFile: '',
            }
          )
      );

      const movements: Movement[] = ms.map(
        (r: any) =>
          mapMovement(r, products)
      );

      const running = new Map<
        string,
        number
      >(
        products.map(
          (p: Product) => [
            p.id,
            p.stock,
          ]
        )
      );

      for (const m of movements) {
        m.stockAfter =
          running.get(m.productId) || 0;

        running.set(
          m.productId,
          (running.get(m.productId) || 0) -
            m.qty
        );
      }

      const orders: Order[] = os.map(
        (r: any) =>
          mapOrder(r, products)
      );

      const returns: ReturnRow[] = rs.map(
        (r: any) =>
          mapReturn(r, products)
      );

      setData({
        companies,
        products,
        movements,
        orders,
        returns,
      });
    } catch (e: any) {
      setDbError(
        e?.message ||
          'Could not load Supabase data.'
      );
    } finally {
      setLoading(false);
      setReady(true);
    }
  };

  useEffect(() => {
    refresh();

    const saved =
      typeof window !== 'undefined'
        ? localStorage.getItem(
            'ov-stock-company'
          )
        : null;

    if (saved) {
      setSelectedCompanyId(saved);
    }
  }, []);

  useEffect(() => {
    if (
      ready &&
      typeof window !== 'undefined'
    ) {
      localStorage.setItem(
        'ov-stock-company',
        selectedCompanyId
      );
    }
  }, [
    selectedCompanyId,
    ready,
  ]);

  useEffect(() => {
    if (
      !ready ||
      !isSupabaseConfigured()
    ) {
      return;
    }

    const timer = setInterval(
      refresh,
      8000
    );

    return () =>
      clearInterval(timer);
  }, [ready]);

  const selectedProducts =
    useMemo<Product[]>(
      () =>
        selectedCompanyId === 'all'
          ? data.products
          : data.products.filter(
              (p: Product) =>
                p.companyId ===
                selectedCompanyId
            ),
      [
        data.products,
        selectedCompanyId,
      ]
    );

  const optimisticRefresh =
    async () => {
      await refresh();
    };

  const api = useMemo<Ctx>(
    () => ({
      ...data,

      selectedCompanyId,
      setSelectedCompanyId,

      selectedProducts,

      loading,
      dbError,

      addProduct: (
        p: Product
      ) => {
        void (async () => {
          try {
            const rows =
              await db.insert(
                'products',
                {
                  company_id:
                    p.companyId,
                  sku: p.sku,
                  product_name:
                    p.name,
                  barcode:
                    p.barcode || null,
                  opening_stock:
                    p.openingStock,
                  received:
                    p.received,
                  shipped:
                    p.shipped,
                  returned:
                    p.returned,
                  low_stock_limit:
                    p.minStock,
                }
              );

            if (!rows?.[0]) {
              throw new Error(
                'Product was not saved.'
              );
            }

            await optimisticRefresh();
          } catch (e: any) {
            alert(
              e?.message ||
                'Failed to add product.'
            );
          }
        })();
      },

      updateProduct: (
        p: Product
      ) => {
        void (async () => {
          try {
            await db.update(
              'products',
              `id=eq.${p.id}`,
              {
                product_name:
                  p.name,
                barcode:
                  p.barcode || null,
                opening_stock:
                  p.openingStock,
                low_stock_limit:
                  p.minStock,
              }
            );

            await optimisticRefresh();
          } catch (e: any) {
            alert(
              e?.message ||
                'Failed to update product.'
            );
          }
        })();
      },

      removeProduct: (
        id: string
      ) => {
        void (async () => {
          if (
            !confirm(
              'Delete this product?'
            )
          ) {
            return;
          }

          try {
            await db.remove(
              'products',
              `id=eq.${id}`
            );

            await optimisticRefresh();
          } catch (e: any) {
            alert(
              e?.message ||
                'Product cannot be deleted after it has linked activity.'
            );
          }
        })();
      },

      adjustStock: (
        id: string,
        qty: number,
        type:
          | 'Stock In'
          | 'Stock Out'
          | 'Return',
        platform = '',
        shippingPartner = '',
        note = ''
      ) => {
        if (type === 'Return') {
          return false;
        }

        const p =
          data.products.find(
            (x: Product) =>
              x.id === id
          );

        if (
          !p ||
          qty <= 0 ||
          (
            type === 'Stock Out' &&
            qty > p.stock
          )
        ) {
          return false;
        }

        void (async () => {
          try {
            await db.rpc(
              'adjust_stock',
              {
                p_product_id: id,
                p_quantity: qty,
                p_movement_type:
                  type,
                p_platform:
                  platform || null,
                p_shipping_partner:
                  shippingPartner ||
                  null,
                p_note:
                  note || null,
              }
            );

            await optimisticRefresh();
          } catch (e: any) {
            alert(
              e?.message ||
                'Stock update failed.'
            );

            await optimisticRefresh();
          }
        })();

        return true;
      },

      addOrder: (
        o: Omit<Order, 'id'>
      ) => {
        void (async () => {
          const p =
            data.products.find(
              (x: Product) =>
                x.companyId ===
                  o.companyId &&
                x.sku === o.sku
            );

          if (!p) {
            return;
          }

          try {
            await db.rpc(
              'adjust_stock',
              {
                p_product_id:
                  p.id,
                p_quantity:
                  o.items,
                p_movement_type:
                  'Stock Out',
                p_platform:
                  o.platform,
                p_shipping_partner:
                  o.shippingPartner ||
                  null,
                p_note:
                  'Marketplace order',
              }
            );

            await db.insert(
              'orders',
              {
                company_id:
                  o.companyId,
                product_id:
                  p.id,
                platform:
                  o.platform,
                quantity:
                  o.items,
                shipping_partner:
                  o.shippingPartner ||
                  null,
                order_date:
                  o.date,
              }
            );

            await optimisticRefresh();
          } catch (e: any) {
            alert(
              e?.message ||
                'Failed to save order.'
            );

            await optimisticRefresh();
          }
        })();
      },

      addReturn: (
        r: Omit<
          ReturnRow,
          'id'
        >
      ) => {
        void (async () => {
          const p =
            data.products.find(
              (x: Product) =>
                x.companyId ===
                  r.companyId &&
                x.sku === r.sku
            );

          if (!p) {
            return;
          }

          try {
            await db.insert(
              'returns',
              {
                company_id:
                  r.companyId,
                product_id:
                  p.id,
                platform:
                  r.platform,
                quantity:
                  r.qty,
                qc_status:
                  'pending',
                shipping_partner:
                  r.shippingPartner ||
                  null,
                return_date:
                  r.date,
              }
            );

            await optimisticRefresh();
          } catch (e: any) {
            alert(
              e?.message ||
                'Failed to save return.'
            );
          }
        })();
      },

      processReturn: (
        id: string,
        condition:
          | 'Resellable'
          | 'Damaged'
      ) => {
        const val =
          condition === 'Resellable'
            ? 'resellable'
            : 'damaged';

        void (async () => {
          try {
            await db.rpc(
              'process_return',
              {
                p_return_id:
                  id,
                p_condition:
                  val,
              }
            );

            await optimisticRefresh();
          } catch (e: any) {
            alert(
              e?.message ||
                'Return processing failed.'
            );

            await optimisticRefresh();
          }
        })();

        return true;
      },

      resetData: () => {
        alert(
          'Supabase is now the source of truth. Excel reset is disabled here to prevent accidental cloud data loss.'
        );
      },
    }),
    [
      data,
      selectedCompanyId,
      selectedProducts,
      loading,
      dbError,
    ]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const x = useContext(Ctx);

  if (!x) {
    throw new Error(
      'useStore must be inside StoreProvider'
    );
  }

  return x;
}
