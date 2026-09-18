from pathlib import Path
import subprocess,uuid,hashlib
root=Path(__file__).resolve().parents[3]
name='moventra_test_catalog_'+uuid.uuid4().hex
subprocess.run(['createdb','-h','/tmp',name],check=True)
def sql(s,ok=True):
 r=subprocess.run(['psql','-h','/tmp','-d',name,'-X','-qAt','-v','ON_ERROR_STOP=1'],input=s,text=True,capture_output=True)
 assert (r.returncode==0)==ok,r.stderr
 return r.stdout.strip()
try:
 sql('CREATE TABLE schema_migrations(version int primary key,checksum text,applied_at timestamptz DEFAULT now());')
 for p in sorted((root/'services/api/internal/database').glob('*.sql')):
  n=int(p.name[:3])
  if n==6: continue
  sql(p.read_text()+f"\nINSERT INTO schema_migrations VALUES({n},'{hashlib.sha256(p.read_bytes()).hexdigest()}',now());")
 supplier='69654f5f-780e-55ad-8a06-4ff4715afc95'
 sql(f"INSERT INTO issuing_suppliers(id,name,adapter,status) VALUES('{supplier}','fixture','slash','paused');")
 script=(root/'deploy/2026-09-18-issuing-catalog.sql').read_text()
 import re
 pairs=re.findall(r"\('([0-9]{8})','(card_product_[a-z0-9]+)'\)",script)
 for bin,upstream in pairs:
  id=str(uuid.uuid4())
  sql(f"INSERT INTO issuing_products(id,supplier_id,name,bin,upstream_id,status) VALUES('{id}','{supplier}','fixture','{bin}','{upstream}','draft'); INSERT INTO issuing_catalog_sources VALUES('{supplier}','{upstream}','{bin}','active','{id}',now(),'fixture');")
 sql("UPDATE issuing_products SET revision=2 WHERE bin='40024200';")
 sql(script,False)
 assert sql("SELECT count(*) FROM issuing_products WHERE status='draft';")=='8'
 assert sql('SELECT count(*) FROM issuing_audit;')=='0'
 sql("UPDATE issuing_products SET revision=1 WHERE bin='40024200';")
 sql("CREATE FUNCTION fixture_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER fixture_fail BEFORE INSERT ON issuing_audit FOR EACH ROW EXECUTE FUNCTION fixture_audit_fail();")
 sql(script,False)
 assert sql("SELECT count(*) FROM issuing_products WHERE status='draft';")=='8'
 sql('DROP TRIGGER fixture_fail ON issuing_audit;')
 sql(script); sql(script)
 assert sql("SELECT count(*) FROM issuing_products WHERE status='active' AND fee_minor=1000 AND minimum_minor=2000 AND revision=2;")=='8'
 assert sql("SELECT count(*) FROM issuing_audit WHERE actor_id IS NULL AND jsonb_array_length(detail->'before')=8 AND jsonb_array_length(detail->'after')=8;")=='1'
 assert sql("SELECT status FROM issuing_suppliers;")=='paused'
 assert sql('SELECT count(*) FROM issuing_orders;')=='0'
 print('PASS: exact 8-product baseline; drift rollback; audit failure rollback; prices USD10/20; idempotency; supplier and financial state unchanged')
finally:
 subprocess.run(['dropdb','-h','/tmp',name],check=True)
