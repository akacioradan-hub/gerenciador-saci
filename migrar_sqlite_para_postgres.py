"""Migra dados de um clientes.db antigo para o banco definido em DATABASE_URL.
Uso: defina DATABASE_URL e execute: python migrar_sqlite_para_postgres.py
"""
import os
import sqlite3
from pathlib import Path
from app import app, db, Cliente, Pagamento
from datetime import date

SRC = Path(__file__).resolve().parent / "clientes.db"
if not SRC.exists():
    raise SystemExit("clientes.db não encontrado nesta pasta.")
if not os.getenv("DATABASE_URL"):
    raise SystemExit("Defina DATABASE_URL para o PostgreSQL antes de migrar.")

with sqlite3.connect(SRC) as src:
    src.row_factory = sqlite3.Row
    clientes = src.execute("SELECT * FROM clientes ORDER BY id").fetchall()
    pagamentos = src.execute("SELECT * FROM pagamentos ORDER BY id").fetchall()

with app.app_context():
    db.create_all()
    if db.session.execute(db.select(Cliente.id).limit(1)).first():
        raise SystemExit("Banco destino já contém clientes; migração cancelada para evitar duplicação.")
    for c in clientes:
        previsao = date.fromisoformat(c["previsao"]) if c["previsao"] else None
        db.session.add(Cliente(id=c["id"], nome=c["nome"], divida=c["divida"], previsao=previsao))
    db.session.flush()
    for p in pagamentos:
        db.session.add(Pagamento(
            id=p["id"], cliente_id=p["cliente_id"], data=date.fromisoformat(p["data"]),
            valor=p["valor"], observacao=p["observacao"]
        ))
    db.session.commit()
print(f"Migração concluída: {len(clientes)} clientes e {len(pagamentos)} pagamentos.")
