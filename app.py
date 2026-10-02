import os
import csv
import io
import json
from datetime import date
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///clientes.db"))

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-change-me")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
if os.getenv("RENDER") or os.getenv("RAILWAY_ENVIRONMENT"):
    app.config["SESSION_COOKIE_SECURE"] = True

db = SQLAlchemy(app)


class Cliente(db.Model):
    __tablename__ = "clientes"
    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(180), nullable=False, index=True)
    divida = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    previsao = db.Column(db.Date, nullable=True, index=True)
    criado_em = db.Column(db.DateTime, nullable=False, server_default=func.now())
    pagamentos = db.relationship("Pagamento", back_populates="cliente", cascade="all, delete-orphan")


class Pagamento(db.Model):
    __tablename__ = "pagamentos"
    id = db.Column(db.Integer, primary_key=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey("clientes.id", ondelete="CASCADE"), nullable=False, index=True)
    data = db.Column(db.Date, nullable=False, index=True)
    valor = db.Column(db.Numeric(12, 2), nullable=False)
    observacao = db.Column(db.Text, nullable=True)
    criado_em = db.Column(db.DateTime, nullable=False, server_default=func.now())
    cliente = db.relationship("Cliente", back_populates="pagamentos")


def init_db():
    with app.app_context():
        try:
            db.create_all()
            app.logger.info("Banco de dados inicializado com sucesso.")
        except Exception:
            app.logger.exception("Erro ao inicializar o banco de dados.")
            raise


def admin_credentials_ok(username, password):
    expected_user = os.getenv("ADMIN_USER", "admin")
    password_hash = os.getenv("ADMIN_PASSWORD_HASH")
    if password_hash:
        return username == expected_user and check_password_hash(password_hash, password)
    expected_password = os.getenv("ADMIN_PASSWORD", "troque-esta-senha")
    return username == expected_user and password == expected_password


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("logged_in"):
            if request.path.startswith("/api/"):
                return jsonify({"erro": "Sessão expirada. Faça login novamente."}), 401
            return redirect(url_for("login", next=request.path))
        return fn(*args, **kwargs)
    return wrapper


@app.get("/login")
def login():
    if session.get("logged_in"):
        return redirect(url_for("index"))
    return render_template("login.html", erro=None)


@app.post("/login")
def login_post():
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    if not admin_credentials_ok(username, password):
        return render_template("login.html", erro="Usuário ou senha inválidos."), 401
    session.clear()
    session["logged_in"] = True
    session["username"] = username
    return redirect(request.args.get("next") or url_for("index"))


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


def total_pago(cliente):
    return sum(float(p.valor or 0) for p in cliente.pagamentos)


def ultimo_pagamento(cliente):
    datas = [p.data for p in cliente.pagamentos if p.data]
    return max(datas) if datas else None


def cliente_dict(cliente):
    pago = total_pago(cliente)
    divida = float(cliente.divida or 0)
    saldo = max(0.0, divida - pago)
    if saldo <= 0:
        status = "QUITADO"
    elif not cliente.previsao:
        status = "SEM PREVISÃO"
    else:
        status = "ATRASADO" if cliente.previsao < date.today() else "EM ABERTO"
    ultimo = ultimo_pagamento(cliente)
    return {
        "id": cliente.id,
        "nome": cliente.nome,
        "divida": divida,
        "previsao": cliente.previsao.isoformat() if cliente.previsao else None,
        "total_pago": pago,
        "saldo": saldo,
        "ultimo_pagamento": ultimo.isoformat() if ultimo else None,
        "status": status,
    }


@app.get("/")
@login_required
def index():
    return render_template("index.html", username=session.get("username"))


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/ready")
def ready():
    try:
        db.session.execute(db.text("SELECT 1"))
        return jsonify({"status": "ok", "database": "connected"})
    except Exception as exc:
        app.logger.exception("Falha de conexão com o banco")
        return jsonify({"status": "erro", "database": str(exc)}), 500


@app.get("/api/clientes")
@login_required
def listar_clientes():
    busca = (request.args.get("q") or "").strip()
    stmt = db.select(Cliente)
    if busca:
        stmt = stmt.where(Cliente.nome.ilike(f"%{busca}%"))
    stmt = stmt.order_by(Cliente.nome.asc())
    clientes = db.session.execute(stmt).scalars().all()
    return jsonify([cliente_dict(c) for c in clientes])


@app.post("/api/clientes")
@login_required
def criar_cliente():
    data = request.get_json(silent=True) or {}
    nome = (data.get("nome") or "").strip()
    try:
        divida = float(data.get("divida", 0))
    except (TypeError, ValueError):
        return jsonify({"erro": "Valor da dívida inválido."}), 400
    if not nome:
        return jsonify({"erro": "Informe o nome do cliente."}), 400
    if divida < 0:
        return jsonify({"erro": "A dívida não pode ser negativa."}), 400
    previsao = None
    if data.get("previsao"):
        try:
            previsao = date.fromisoformat(data["previsao"])
        except ValueError:
            return jsonify({"erro": "Data de previsão inválida."}), 400
    cliente = Cliente(nome=nome, divida=divida, previsao=previsao)
    db.session.add(cliente)
    db.session.commit()
    return jsonify({"id": cliente.id}), 201


@app.put("/api/clientes/<int:cliente_id>")
@login_required
def atualizar_cliente(cliente_id):
    cliente = db.session.get(Cliente, cliente_id)
    if not cliente:
        return jsonify({"erro": "Cliente não encontrado."}), 404
    data = request.get_json(silent=True) or {}
    nome = (data.get("nome") or "").strip()
    try:
        divida = float(data.get("divida", 0))
    except (TypeError, ValueError):
        return jsonify({"erro": "Valor da dívida inválido."}), 400
    if not nome:
        return jsonify({"erro": "Informe o nome do cliente."}), 400
    if divida < 0:
        return jsonify({"erro": "A dívida não pode ser negativa."}), 400
    previsao = None
    if data.get("previsao"):
        try:
            previsao = date.fromisoformat(data["previsao"])
        except ValueError:
            return jsonify({"erro": "Data de previsão inválida."}), 400
    cliente.nome = nome
    cliente.divida = divida
    cliente.previsao = previsao
    db.session.commit()
    return jsonify({"ok": True})


@app.delete("/api/clientes/<int:cliente_id>")
@login_required
def excluir_cliente(cliente_id):
    cliente = db.session.get(Cliente, cliente_id)
    if not cliente:
        return jsonify({"erro": "Cliente não encontrado."}), 404
    db.session.delete(cliente)
    db.session.commit()
    return jsonify({"ok": True})


@app.get("/api/pagamentos")
@login_required
def listar_pagamentos():
    stmt = db.select(Pagamento).order_by(Pagamento.data.desc(), Pagamento.id.desc())
    pags = db.session.execute(stmt).scalars().all()
    return jsonify([{
        "id": p.id,
        "cliente_id": p.cliente_id,
        "cliente_nome": p.cliente.nome,
        "data": p.data.isoformat(),
        "valor": float(p.valor),
        "observacao": p.observacao,
    } for p in pags])


@app.post("/api/pagamentos")
@login_required
def criar_pagamento():
    data = request.get_json(silent=True) or {}
    try:
        cliente_id = int(data.get("cliente_id"))
        valor = float(data.get("valor"))
    except (TypeError, ValueError):
        return jsonify({"erro": "Cliente ou valor inválido."}), 400
    if valor <= 0:
        return jsonify({"erro": "O valor deve ser maior que zero."}), 400
    try:
        pagamento_data = date.fromisoformat(data.get("data") or "")
    except ValueError:
        return jsonify({"erro": "Informe uma data de pagamento válida."}), 400
    cliente = db.session.get(Cliente, cliente_id)
    if not cliente:
        return jsonify({"erro": "Cliente não encontrado."}), 404
    observacao = (data.get("observacao") or "").strip() or None
    pagamento = Pagamento(cliente_id=cliente_id, data=pagamento_data, valor=valor, observacao=observacao)
    db.session.add(pagamento)
    db.session.commit()
    return jsonify({"id": pagamento.id}), 201


@app.delete("/api/pagamentos/<int:pagamento_id>")
@login_required
def excluir_pagamento(pagamento_id):
    pagamento = db.session.get(Pagamento, pagamento_id)
    if not pagamento:
        return jsonify({"erro": "Pagamento não encontrado."}), 404
    db.session.delete(pagamento)
    db.session.commit()
    return jsonify({"ok": True})


@app.get("/api/dashboard")
@login_required
def dashboard():
    clientes = db.session.execute(db.select(Cliente)).scalars().all()
    itens = [cliente_dict(c) for c in clientes]
    total_receber = sum(i["divida"] for i in itens)
    total_recebido = sum(i["total_pago"] for i in itens)
    saldo = sum(i["saldo"] for i in itens)
    status = {k: 0 for k in ["QUITADO", "EM ABERTO", "ATRASADO", "SEM PREVISÃO"]}
    for item in itens:
        status[item["status"]] += 1
    proximos = sorted(itens, key=lambda x: (x["previsao"] is None, x["previsao"] or "9999-12-31", x["nome"].lower()))[:12]
    return jsonify({
        "total_receber": total_receber,
        "total_recebido": total_recebido,
        "saldo_devedor": saldo,
        "clientes_atraso": status["ATRASADO"],
        "status": status,
        "proximos": proximos,
    })


@app.get("/api/exportar/clientes.csv")
@login_required
def exportar_clientes():
    clientes = db.session.execute(db.select(Cliente).order_by(Cliente.nome.asc())).scalars().all()
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["ID","Cliente","Dívida inicial","Previsão","Total pago","Saldo","Último pagamento","Status"])
    for c in clientes:
        d = cliente_dict(c)
        writer.writerow([d["id"], d["nome"], f'{d["divida"]:.2f}', d["previsao"] or "", f'{d["total_pago"]:.2f}', f'{d["saldo"]:.2f}', d["ultimo_pagamento"] or "", d["status"]])
    mem = io.BytesIO(output.getvalue().encode("utf-8-sig"))
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name="clientes.csv")


@app.get("/api/backup")
@login_required
def backup_banco():
    clientes = db.session.execute(db.select(Cliente)).scalars().all()
    pagamentos = db.session.execute(db.select(Pagamento)).scalars().all()
    payload = {
        "clientes": [{
            "id": c.id,
            "nome": c.nome,
            "divida": float(c.divida),
            "previsao": c.previsao.isoformat() if c.previsao else None,
            "criado_em": c.criado_em.isoformat() if c.criado_em else None,
        } for c in clientes],
        "pagamentos": [{
            "id": p.id,
            "cliente_id": p.cliente_id,
            "data": p.data.isoformat(),
            "valor": float(p.valor),
            "observacao": p.observacao,
            "criado_em": p.criado_em.isoformat() if p.criado_em else None,
        } for p in pagamentos],
    }
    mem = io.BytesIO(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))
    return send_file(mem, mimetype="application/json", as_attachment=True, download_name="backup_clientes.json")


init_db()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
