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


class Usuario(db.Model):
    __tablename__ = "usuarios"
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False, unique=True, index=True)
    nome = db.Column(db.String(160), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default="usuario")
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_em = db.Column(db.DateTime, nullable=False, server_default=func.now())

    def verificar_senha(self, senha):
        return check_password_hash(self.password_hash, senha)

    def definir_senha(self, senha):
        self.password_hash = generate_password_hash(senha)


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
            # Cria o administrador inicial somente se ainda não existir nenhum usuário.
            if db.session.execute(db.select(func.count(Usuario.id))).scalar_one() == 0:
                username = (os.getenv("ADMIN_USER", "admin") or "admin").strip()
                senha = os.getenv("ADMIN_PASSWORD", "troque-esta-senha")
                admin = Usuario(username=username, nome="Administrador", role="admin", ativo=True)
                admin.definir_senha(senha)
                db.session.add(admin)
                db.session.commit()
                app.logger.info("Usuário administrador inicial criado: %s", username)
            app.logger.info("Banco de dados inicializado com sucesso.")
        except Exception:
            db.session.rollback()
            app.logger.exception("Erro ao inicializar o banco de dados.")
            raise


def usuario_atual():
    uid = session.get("user_id")
    return db.session.get(Usuario, uid) if uid else None


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = usuario_atual()
        if not user or not user.ativo or user.role != "admin":
            if request.path.startswith("/api/"):
                return jsonify({"erro": "Acesso restrito ao administrador."}), 403
            return redirect(url_for("index"))
        return fn(*args, **kwargs)
    return wrapper


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = usuario_atual()
        if not user or not user.ativo:
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify({"erro": "Sessão expirada. Faça login novamente."}), 401
            return redirect(url_for("login", next=request.path))
        return fn(*args, **kwargs)
    return wrapper


@app.get("/login")
def login():
    if usuario_atual():
        return redirect(url_for("index"))
    return render_template("login.html", erro=None)


@app.post("/login")
def login_post():
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    user = db.session.execute(db.select(Usuario).where(Usuario.username == username)).scalar_one_or_none()
    if not user or not user.ativo or not user.verificar_senha(password):
        return render_template("login.html", erro="Usuário ou senha inválidos."), 401
    session.clear()
    session["user_id"] = user.id
    session["username"] = user.username
    session["role"] = user.role
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
    user = usuario_atual()
    return render_template("index.html", username=user.username, nome_usuario=user.nome, is_admin=(user.role == "admin"))


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


def add_months(year, month, offset):
    idx = (year * 12 + (month - 1)) + offset
    return idx // 12, idx % 12 + 1


@app.get("/api/dashboard")
@login_required
def dashboard():
    clientes = db.session.execute(db.select(Cliente)).scalars().all()
    pagamentos = db.session.execute(db.select(Pagamento)).scalars().all()
    itens = [cliente_dict(c) for c in clientes]

    total_receber = sum(i["divida"] for i in itens)
    total_recebido = sum(i["total_pago"] for i in itens)
    saldo = sum(i["saldo"] for i in itens)
    status = {k: 0 for k in ["QUITADO", "EM ABERTO", "ATRASADO", "SEM PREVISÃO"]}
    for item in itens:
        status[item["status"]] += 1

    hoje = date.today()
    valor_atrasado = sum(i["saldo"] for i in itens if i["status"] == "ATRASADO")

    vencem_hoje = []
    atrasados = []
    for item in itens:
        if item["saldo"] <= 0 or not item["previsao"]:
            continue
        data_prevista = date.fromisoformat(item["previsao"])
        resumo = {
            "id": item["id"],
            "nome": item["nome"],
            "previsao": item["previsao"],
            "saldo": item["saldo"],
            "status": item["status"],
        }
        if data_prevista == hoje:
            vencem_hoje.append(resumo)
        elif data_prevista < hoje:
            atrasados.append(resumo)

    vencem_hoje.sort(key=lambda x: x["nome"].lower())
    atrasados.sort(key=lambda x: (x["previsao"], x["nome"].lower()))

    recebimentos_mensais = []
    for offset in range(-5, 1):
        ano, mes = add_months(hoje.year, hoje.month, offset)
        valor = sum(float(p.valor or 0) for p in pagamentos if p.data and p.data.year == ano and p.data.month == mes)
        recebimentos_mensais.append({"mes": f"{ano:04d}-{mes:02d}", "valor": valor})

    previsao_mensal = []
    for offset in range(0, 6):
        ano, mes = add_months(hoje.year, hoje.month, offset)
        valor = 0.0
        for item in itens:
            if item["saldo"] <= 0 or not item["previsao"]:
                continue
            p = date.fromisoformat(item["previsao"])
            if p.year == ano and p.month == mes and p >= hoje:
                valor += item["saldo"]
        previsao_mensal.append({"mes": f"{ano:04d}-{mes:02d}", "valor": valor})

    total_previsto_futuro = sum(x["valor"] for x in previsao_mensal)
    proximos = sorted(itens, key=lambda x: (x["previsao"] is None, x["previsao"] or "9999-12-31", x["nome"].lower()))[:12]

    return jsonify({
        "total_receber": total_receber,
        "total_recebido": total_recebido,
        "saldo_devedor": saldo,
        "clientes_atraso": status["ATRASADO"],
        "valor_atrasado": valor_atrasado,
        "vencem_hoje": vencem_hoje,
        "atrasados": atrasados[:20],
        "total_alertas": len(vencem_hoje) + len(atrasados),
        "total_previsto_futuro": total_previsto_futuro,
        "recebimentos_mensais": recebimentos_mensais,
        "previsao_mensal": previsao_mensal,
        "status": status,
        "proximos": proximos,
    })


@app.get("/api/usuarios")
@login_required
@admin_required
def listar_usuarios():
    usuarios = db.session.execute(db.select(Usuario).order_by(Usuario.nome.asc())).scalars().all()
    return jsonify([{
        "id": u.id, "username": u.username, "nome": u.nome, "role": u.role,
        "ativo": bool(u.ativo), "criado_em": u.criado_em.isoformat() if u.criado_em else None
    } for u in usuarios])


@app.post("/api/usuarios")
@login_required
@admin_required
def criar_usuario():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    nome = (data.get("nome") or "").strip()
    senha = data.get("senha") or ""
    role = data.get("role") if data.get("role") in ("admin", "usuario") else "usuario"
    if len(username) < 3:
        return jsonify({"erro": "O usuário deve ter pelo menos 3 caracteres."}), 400
    if not nome:
        return jsonify({"erro": "Informe o nome do usuário."}), 400
    if len(senha) < 6:
        return jsonify({"erro": "A senha deve ter pelo menos 6 caracteres."}), 400
    if db.session.execute(db.select(Usuario).where(Usuario.username == username)).scalar_one_or_none():
        return jsonify({"erro": "Este nome de usuário já existe."}), 409
    u = Usuario(username=username, nome=nome, role=role, ativo=True)
    u.definir_senha(senha)
    db.session.add(u)
    db.session.commit()
    return jsonify({"id": u.id}), 201


@app.put("/api/usuarios/<int:usuario_id>")
@login_required
@admin_required
def atualizar_usuario(usuario_id):
    u = db.session.get(Usuario, usuario_id)
    if not u:
        return jsonify({"erro": "Usuário não encontrado."}), 404
    data = request.get_json(silent=True) or {}
    nome = (data.get("nome") or u.nome).strip()
    role = data.get("role") if data.get("role") in ("admin", "usuario") else u.role
    ativo = bool(data.get("ativo", u.ativo))
    senha = data.get("senha") or ""
    if not nome:
        return jsonify({"erro": "Informe o nome do usuário."}), 400
    atual = usuario_atual()
    if u.id == atual.id and (role != "admin" or not ativo):
        return jsonify({"erro": "Você não pode remover seu próprio acesso de administrador."}), 400
    u.nome = nome
    u.role = role
    u.ativo = ativo
    if senha:
        if len(senha) < 6:
            return jsonify({"erro": "A nova senha deve ter pelo menos 6 caracteres."}), 400
        u.definir_senha(senha)
    db.session.commit()
    return jsonify({"ok": True})


@app.delete("/api/usuarios/<int:usuario_id>")
@login_required
@admin_required
def excluir_usuario(usuario_id):
    u = db.session.get(Usuario, usuario_id)
    if not u:
        return jsonify({"erro": "Usuário não encontrado."}), 404
    if u.id == usuario_atual().id:
        return jsonify({"erro": "Você não pode excluir o usuário que está conectado."}), 400
    db.session.delete(u)
    db.session.commit()
    return jsonify({"ok": True})


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
