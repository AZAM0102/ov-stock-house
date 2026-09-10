-- THE DUKAAN parent SKU groups from the latest approved Excel.
-- Idempotent and preserves existing stock/history.
do $$
declare c uuid;
begin
  select id into c from public.companies where name='THE DUKAAN';
  if c is null then return; end if;
  update public.products set sku='KILLER-M1-ORANGE', product_name=coalesce(nullif(product_name,''),'KILLER-M1-ORANGE') where company_id=c and sku='KIL-M1-OR';
  update public.products set sku='KILLER-M1-RED', product_name=coalesce(nullif(product_name,''),'KILLER-M1-RED') where company_id=c and sku='KIL-M1-RD';
  update public.products set sku='KILLER-M1-GREEN', product_name=coalesce(nullif(product_name,''),'KILLER-M1-GREEN') where company_id=c and sku='KIL-M1-GR';
  update public.products set sku='WG-M1-SKY BLUE', product_name=coalesce(nullif(product_name,''),'WG-M1-SKY BLUE') where company_id=c and sku='WG-M1-SBL';
  update public.products set sku='WG-M1-NAVY BLUE', product_name=coalesce(nullif(product_name,''),'WG-M1-NAVY BLUE') where company_id=c and sku='WG-M1-NBL';
  update public.products set sku='WG-M1-BLACK', product_name=coalesce(nullif(product_name,''),'WG-M1-BLACK') where company_id=c and sku='WG-M1-BK';
  update public.products set sku='WG-M3-SKY BLUE', product_name=coalesce(nullif(product_name,''),'WG-M3-SKY BLUE') where company_id=c and sku='WG-M3-SBL';
  update public.products set sku='WG-M3-NAVY BLUE', product_name=coalesce(nullif(product_name,''),'WG-M3-NAVY BLUE') where company_id=c and sku='WG-M3-NBL';
  update public.products set sku='WG-M3-BLACK', product_name=coalesce(nullif(product_name,''),'WG-M3-BLACK') where company_id=c and sku='WG-M3-BK';
  update public.products set sku='WG-M2-SKY BLUE', product_name=coalesce(nullif(product_name,''),'WG-M2-SKY BLUE') where company_id=c and sku='WRN-M2-SBL';
  update public.products set sku='WG-M2-BLACK', product_name=coalesce(nullif(product_name,''),'WG-M2-BLACK') where company_id=c and sku='WRN-M2-BK';
  update public.products set is_active=false where company_id=c and sku='WG-M2-BK';
  insert into public.products(company_id,sku,product_name,opening_stock,received,shipped,returned,low_stock_limit,cost_price,is_active)
  select c,'Miss & Chief Kids','Miss & Chief Kids',0,0,0,0,20,500,true where not exists(select 1 from public.products where company_id=c and lower(sku)=lower('Miss & Chief Kids'));
  insert into public.products(company_id,sku,product_name,opening_stock,received,shipped,returned,low_stock_limit,cost_price,is_active)
  select c,'duffel_bag','duffel_bag',0,0,0,0,20,500,true where not exists(select 1 from public.products where company_id=c and lower(sku)=lower('duffel_bag'));
end $$;

with parents(company_sku, child_sku) as (values
('KILLER-M1-ORANGE','KLL-ORG-01'),('KILLER-M1-ORANGE','KILL-ORG-O1'),('KILLER-M1-ORANGE','KIL-M1-OR'),
('Miss & Chief Kids','SPIDERMAN-BLUE'),('Miss & Chief Kids','KID-NURSERY-FOOTBALL-BLUE'),('Miss & Chief Kids','KID-NURSERY-UNICORN-PINK'),('Miss & Chief Kids','KID-NURSERY-MARVEL-GREY'),('Miss & Chief Kids','KID-NURSERY-SPIDERMAN-NAVY-BL'),('Miss & Chief Kids','KID-NURSERY-ANIME-BOY-BLK'),('Miss & Chief Kids','MCQUEEN-PURPLE'),
('WG-M1-SKY BLUE','M1-SKY-BLUE-WROGN-0011'),('WG-M1-SKY BLUE','WG-M1-SBL'),('WG-M1-SKY BLUE','M1-0012-WG-SKY-BLUE'),('WG-M1-SKY BLUE','M1-SKY-BLUE-WROGN-001'),('WG-M1-SKY BLUE','WG-M1-SBL-1'),('WG-M1-SKY BLUE','M1-00001-WG-SBL'),('WG-M1-SKY BLUE','M1-MULTICOLOR-WROGN-003'),
('WG-M3-SKY BLUE','M3-00001-WG-SBL-GY'),('WG-M3-SKY BLUE','M3-0021-WG-SKY-BL'),('WG-M3-SKY BLUE','M3-SKY-BLUE-WROGN-003'),('WG-M3-SKY BLUE','WG-M3-SBL'),('WG-M3-SKY BLUE','WG-M3-SBL-1'),
('WG-M2-SKY BLUE','WRN-M2-SBL'),('WG-M2-SKY BLUE','WR-M2-SBL-1'),
('duffel_bag','WR-DFL-M1-BK'),('duffel_bag','WR-DFL-M1-SBL'),('duffel_bag','WR-DFL-M1-BL'),
('KILLER-M1-RED','KILL-RED-O1'),('KILLER-M1-RED','KLL-RED-01'),('KILLER-M1-RED','KIL-M1-RD'),
('WG-M1-NAVY BLUE','WG-M1-NBL'),('WG-M1-NAVY BLUE','WG-M1-NBL-1'),('WG-M1-NAVY BLUE','M1-0012-WG-NBL'),('WG-M1-NAVY BLUE','M1-BLUE-WROGN-003'),('WG-M1-NAVY BLUE','M1-BLUE-WROGN-001'),('WG-M1-NAVY BLUE','M1-00001-WG-NBL'),
('WG-M3-NAVY BLUE','M3-NBL-WROGN-003'),('WG-M3-NAVY BLUE','M3-00001-WG-NAVY-BLUE'),('WG-M3-NAVY BLUE','M3-0021-WG-NAVY-BLUE'),('WG-M3-NAVY BLUE','WG-M3-NBL-1'),('WG-M3-NAVY BLUE','WG-M3-NBL'),
('WG-M2-BLACK','WRN-M2-BK'),('WG-M2-BLACK','WG-M2-BK'),
('KILLER-M1-GREEN','KLL-GREEN-01'),('KILLER-M1-GREEN','KIL-M1-GR'),('KILLER-M1-GREEN','KILL-GRN-O1'),
('WG-M1-BLACK','WG-M1-BK'),('WG-M1-BLACK','M1-BK-GY-WROGN-003'),('WG-M1-BLACK','WG-M1-BK-1'),('WG-M1-BLACK','M1-BLK-WROGN-001'),('WG-M1-BLACK','M1-0012-WG-BLK'),('WG-M1-BLACK','M1-00001-WG-BLK'),
('WG-M3-BLACK','M3-BLK-WROGN-003'),('WG-M3-BLACK','M3-0021-WG-BLACK'),('WG-M3-BLACK','M3-00001-WG-BK-GY'),('WG-M3-BLACK','WG-M3-BK')
)
insert into public.product_sku_mappings(company_id,product_id,platform,marketplace_sku)
select c.id,p.id,'Flipkart',x.child_sku from parents x join public.companies c on c.name='THE DUKAAN' join public.products p on p.company_id=c.id and p.sku=x.company_sku
where not exists(select 1 from public.product_sku_mappings m where m.company_id=c.id and m.platform='Flipkart' and lower(btrim(m.marketplace_sku))=lower(btrim(x.child_sku)));
