import os
import hmac
import csv
import io
import json
from datetime import date
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for, session, abort
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func, inspect, or_
from werkzeug.security import check_password_hash, generate_password_hash


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///clientes.db"))
CONSULTA_TOKEN = (os.getenv("CONSULTA_TOKEN") or "").strip()

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
    tipo_pessoa = db.Column(db.String(2), nullable=True, default="PF")
    cpf_cnpj = db.Column(db.String(18), nullable=True, index=True)
    rg_ie = db.Column(db.String(30), nullable=True)
    data_nascimento = db.Column(db.Date, nullable=True)
    telefone = db.Column(db.String(25), nullable=True)
    whatsapp = db.Column(db.String(25), nullable=True)
    email = db.Column(db.String(160), nullable=True)
    cep = db.Column(db.String(10), nullable=True)
    logradouro = db.Column(db.String(180), nullable=True)
    numero = db.Column(db.String(30), nullable=True)
    complemento = db.Column(db.String(120), nullable=True)
    bairro = db.Column(db.String(100), nullable=True)
    cidade = db.Column(db.String(100), nullable=True)
    uf = db.Column(db.String(2), nullable=True)
    observacoes = db.Column(db.Text, nullable=True)
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


class DebitoOrgaoPublico(db.Model):
    __tablename__ = "debitos_orgaos_publicos"
    id = db.Column(db.Integer, primary_key=True)
    nome_orgao = db.Column(db.String(220), nullable=False, index=True)
    tipo_orgao = db.Column(db.String(40), nullable=False, default="Prefeitura")
    data_debito = db.Column(db.Date, nullable=False, index=True)
    valor_debito = db.Column(db.Numeric(14, 2), nullable=False, default=0)
    pago = db.Column(db.Boolean, nullable=False, default=False, index=True)
    numero_nota_fiscal = db.Column(db.String(80), nullable=False, index=True)
    numero_ordem = db.Column(db.String(100), nullable=True, index=True)
    criado_em = db.Column(db.DateTime, nullable=False, server_default=func.now())


def debito_orgao_dict(registro):
    return {
        "id": registro.id,
        "nome_orgao": registro.nome_orgao,
        "tipo_orgao": registro.tipo_orgao,
        "data_debito": registro.data_debito.isoformat(),
        "dia": registro.data_debito.day,
        "mes": registro.data_debito.month,
        "ano": registro.data_debito.year,
        "valor_debito": float(registro.valor_debito or 0),
        "pago": bool(registro.pago),
        "status": "PAGO" if registro.pago else "EM ABERTO",
        "numero_nota_fiscal": registro.numero_nota_fiscal,
        "numero_ordem": registro.numero_ordem,
        "criado_em": registro.criado_em.isoformat() if registro.criado_em else None,
    }


def migrar_campos_cliente():
    """Adiciona novos campos de cadastro sem apagar registros existentes."""
    colunas = {c["name"] for c in inspect(db.engine).get_columns("clientes")}
    novos_campos = {
        "tipo_pessoa": "VARCHAR(2)",
        "cpf_cnpj": "VARCHAR(18)",
        "rg_ie": "VARCHAR(30)",
        "data_nascimento": "DATE",
        "telefone": "VARCHAR(25)",
        "whatsapp": "VARCHAR(25)",
        "email": "VARCHAR(160)",
        "cep": "VARCHAR(10)",
        "logradouro": "VARCHAR(180)",
        "numero": "VARCHAR(30)",
        "complemento": "VARCHAR(120)",
        "bairro": "VARCHAR(100)",
        "cidade": "VARCHAR(100)",
        "uf": "VARCHAR(2)",
        "observacoes": "TEXT",
    }
    alterou = False
    for nome, tipo in novos_campos.items():
        if nome not in colunas:
            db.session.execute(db.text(f"ALTER TABLE clientes ADD COLUMN {nome} {tipo}"))
            alterou = True
    if alterou:
        db.session.commit()
        app.logger.info("Campos adicionais do cadastro de clientes criados com sucesso.")


def migrar_campos_orgaos_publicos():
    """Adiciona novos campos aos débitos de órgãos públicos sem apagar registros existentes."""
    insp = inspect(db.engine)
    if "debitos_orgaos_publicos" not in insp.get_table_names():
        return
    colunas = {c["name"] for c in insp.get_columns("debitos_orgaos_publicos")}
    if "numero_ordem" not in colunas:
        db.session.execute(db.text("ALTER TABLE debitos_orgaos_publicos ADD COLUMN numero_ordem VARCHAR(100)"))
        db.session.commit()
        app.logger.info("Campo numero_ordem criado em debitos_orgaos_publicos com sucesso.")


def init_db():
    with app.app_context():
        try:
            db.create_all()
            migrar_campos_cliente()
            migrar_campos_orgaos_publicos()
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
        "tipo_pessoa": cliente.tipo_pessoa or "PF",
        "cpf_cnpj": cliente.cpf_cnpj or "",
        "rg_ie": cliente.rg_ie or "",
        "data_nascimento": cliente.data_nascimento.isoformat() if cliente.data_nascimento else None,
        "telefone": cliente.telefone or "",
        "whatsapp": cliente.whatsapp or "",
        "email": cliente.email or "",
        "cep": cliente.cep or "",
        "logradouro": cliente.logradouro or "",
        "numero": cliente.numero or "",
        "complemento": cliente.complemento or "",
        "bairro": cliente.bairro or "",
        "cidade": cliente.cidade or "",
        "uf": cliente.uf or "",
        "observacoes": cliente.observacoes or "",
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
    consulta_publica_url = url_for("consulta_publica", token=CONSULTA_TOKEN) if CONSULTA_TOKEN else None
    return render_template(
        "index.html",
        username=user.username,
        nome_usuario=user.nome,
        is_admin=(user.role == "admin"),
        consulta_publica_url=consulta_publica_url,
    )


@app.get("/consulta/<token>")
def consulta_publica(token):
    # Página somente leitura. O token não dá acesso às APIs privadas nem à área administrativa.
    if not CONSULTA_TOKEN or not hmac.compare_digest(token, CONSULTA_TOKEN):
        abort(404)

    stmt = db.select(Cliente).order_by(Cliente.nome.asc())
    registros = db.session.execute(stmt).scalars().all()
    clientes_publicos = []
    for cliente in registros:
        dados = cliente_dict(cliente)
        clientes_publicos.append({
            "nome": dados["nome"],
            "previsao": dados["previsao"],
            "status": dados["status"],
        })

    return render_template(
        "consulta_publica.html",
        clientes=clientes_publicos,
        atualizado_em=date.today().strftime("%d/%m/%Y"),
    )


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
        termo = f"%{busca}%"
        stmt = stmt.where(or_(
            Cliente.nome.ilike(termo),
            Cliente.cpf_cnpj.ilike(termo),
            Cliente.telefone.ilike(termo),
            Cliente.whatsapp.ilike(termo),
            Cliente.email.ilike(termo),
        ))
    stmt = stmt.order_by(Cliente.nome.asc())
    clientes = db.session.execute(stmt).scalars().all()
    return jsonify([cliente_dict(c) for c in clientes])


def limpar_documento(valor):
    return "".join(ch for ch in str(valor or "") if ch.isdigit())


def dados_cliente_payload(data, cliente=None):
    nome = (data.get("nome") or "").strip()
    if not nome:
        return None, "Informe o nome completo do cliente."

    tipo_pessoa = data.get("tipo_pessoa") if data.get("tipo_pessoa") in ("PF", "PJ") else "PF"
    documento = limpar_documento(data.get("cpf_cnpj"))
    if documento and len(documento) not in (11, 14):
        return None, "CPF/CNPJ deve conter 11 ou 14 números."

    try:
        divida = float(data.get("divida", 0) or 0)
    except (TypeError, ValueError):
        return None, "Valor da dívida inválido."
    if divida < 0:
        return None, "A dívida não pode ser negativa."

    def data_iso(campo, rotulo):
        valor = data.get(campo)
        if not valor:
            return None, None
        try:
            return date.fromisoformat(valor), None
        except ValueError:
            return None, f"{rotulo} inválida."

    nascimento, erro = data_iso("data_nascimento", "Data de nascimento")
    if erro:
        return None, erro
    previsao, erro = data_iso("previsao", "Data de previsão")
    if erro:
        return None, erro

    email = (data.get("email") or "").strip().lower()
    if email and ("@" not in email or "." not in email.split("@")[-1]):
        return None, "Informe um e-mail válido."

    uf = (data.get("uf") or "").strip().upper()[:2]
    payload = {
        "nome": nome,
        "tipo_pessoa": tipo_pessoa,
        "cpf_cnpj": documento or None,
        "rg_ie": (data.get("rg_ie") or "").strip() or None,
        "data_nascimento": nascimento,
        "telefone": (data.get("telefone") or "").strip() or None,
        "whatsapp": (data.get("whatsapp") or "").strip() or None,
        "email": email or None,
        "cep": (data.get("cep") or "").strip() or None,
        "logradouro": (data.get("logradouro") or "").strip() or None,
        "numero": (data.get("numero") or "").strip() or None,
        "complemento": (data.get("complemento") or "").strip() or None,
        "bairro": (data.get("bairro") or "").strip() or None,
        "cidade": (data.get("cidade") or "").strip() or None,
        "uf": uf or None,
        "observacoes": (data.get("observacoes") or "").strip() or None,
        "divida": divida,
        "previsao": previsao,
    }
    return payload, None


def documento_duplicado(documento, ignorar_id=None):
    if not documento:
        return False
    stmt = db.select(Cliente).where(Cliente.cpf_cnpj == documento)
    if ignorar_id:
        stmt = stmt.where(Cliente.id != ignorar_id)
    return db.session.execute(stmt).scalar_one_or_none() is not None


@app.post("/api/clientes")
@login_required
def criar_cliente():
    data = request.get_json(silent=True) or {}
    payload, erro = dados_cliente_payload(data)
    if erro:
        return jsonify({"erro": erro}), 400
    if documento_duplicado(payload["cpf_cnpj"]):
        return jsonify({"erro": "Já existe um cliente cadastrado com este CPF/CNPJ."}), 409
    cliente = Cliente(**payload)
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
    payload, erro = dados_cliente_payload(data, cliente)
    if erro:
        return jsonify({"erro": erro}), 400
    if documento_duplicado(payload["cpf_cnpj"], ignorar_id=cliente_id):
        return jsonify({"erro": "Já existe outro cliente cadastrado com este CPF/CNPJ."}), 409
    for campo, valor in payload.items():
        setattr(cliente, campo, valor)
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
    orgaos = db.session.execute(db.select(DebitoOrgaoPublico)).scalars().all()
    itens = [cliente_dict(c) for c in clientes]

    # ---- Clientes ----
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
    clientes_60_dias = []
    for item in itens:
        if item["saldo"] <= 0 or not item["previsao"]:
            continue
        data_prevista = date.fromisoformat(item["previsao"])
        dias_atraso = max(0, (hoje - data_prevista).days)
        resumo = {
            "id": item["id"],
            "nome": item["nome"],
            "previsao": item["previsao"],
            "saldo": item["saldo"],
            "status": item["status"],
            "dias_atraso": dias_atraso,
        }
        if data_prevista == hoje:
            vencem_hoje.append(resumo)
        elif dias_atraso >= 60:
            clientes_60_dias.append(resumo)
        elif data_prevista < hoje:
            atrasados.append(resumo)

    vencem_hoje.sort(key=lambda x: x["nome"].lower())
    atrasados.sort(key=lambda x: (x["previsao"], x["nome"].lower()))
    clientes_60_dias.sort(key=lambda x: (-x["dias_atraso"], x["nome"].lower()))

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
            pprev = date.fromisoformat(item["previsao"])
            if pprev.year == ano and pprev.month == mes and pprev >= hoje:
                valor += item["saldo"]
        previsao_mensal.append({"mes": f"{ano:04d}-{mes:02d}", "valor": valor})

    total_previsto_futuro = sum(x["valor"] for x in previsao_mensal)
    proximos = sorted(itens, key=lambda x: (x["previsao"] is None, x["previsao"] or "9999-12-31", x["nome"].lower()))[:12]

    # ---- Órgãos públicos ----
    org_total = sum(float(r.valor_debito or 0) for r in orgaos)
    org_pago = sum(float(r.valor_debito or 0) for r in orgaos if r.pago)
    org_nao_pago = sum(float(r.valor_debito or 0) for r in orgaos if not r.pago)
    org_qtd = len(orgaos)
    org_qtd_pago = sum(1 for r in orgaos if r.pago)
    org_qtd_nao_pago = sum(1 for r in orgaos if not r.pago)

    orgaos_60_dias = []
    for r in orgaos:
        if r.pago or not r.data_debito:
            continue
        dias_atraso = (hoje - r.data_debito).days
        if dias_atraso >= 60:
            orgaos_60_dias.append({
                "id": r.id,
                "nome_orgao": r.nome_orgao,
                "data_debito": r.data_debito.isoformat(),
                "valor_debito": float(r.valor_debito or 0),
                "numero_nota_fiscal": r.numero_nota_fiscal,
                "numero_ordem": r.numero_ordem,
                "dias_atraso": dias_atraso,
            })
    orgaos_60_dias.sort(key=lambda x: (-x["dias_atraso"], x["nome_orgao"].lower()))

    anos = sorted({r.data_debito.year for r in orgaos if r.data_debito})
    org_por_ano = []
    for ano in anos[-6:]:
        total_ano = sum(float(r.valor_debito or 0) for r in orgaos if r.data_debito and r.data_debito.year == ano)
        pago_ano = sum(float(r.valor_debito or 0) for r in orgaos if r.data_debito and r.data_debito.year == ano and r.pago)
        aberto_ano = total_ano - pago_ano
        org_por_ano.append({"ano": str(ano), "total": total_ano, "pago": pago_ano, "nao_pago": aberto_ano})

    por_orgao = {}
    for r in orgaos:
        if r.pago:
            continue
        nome = r.nome_orgao.strip()
        por_orgao[nome] = por_orgao.get(nome, 0.0) + float(r.valor_debito or 0)
    org_top_devedores = [
        {"nome": nome, "valor": valor}
        for nome, valor in sorted(por_orgao.items(), key=lambda kv: kv[1], reverse=True)[:6]
    ]

    return jsonify({
        "total_receber": total_receber,
        "total_recebido": total_recebido,
        "saldo_devedor": saldo,
        "clientes_atraso": status["ATRASADO"],
        "valor_atrasado": valor_atrasado,
        "vencem_hoje": vencem_hoje,
        "atrasados": atrasados[:20],
        "clientes_60_dias": clientes_60_dias[:30],
        "orgaos_60_dias": orgaos_60_dias[:30],
        "total_alertas": len(vencem_hoje) + len(atrasados) + len(clientes_60_dias) + len(orgaos_60_dias),
        "total_previsto_futuro": total_previsto_futuro,
        "recebimentos_mensais": recebimentos_mensais,
        "previsao_mensal": previsao_mensal,
        "status": status,
        "proximos": proximos,
        "orgaos": {
            "total": org_total,
            "total_pago": org_pago,
            "total_nao_pago": org_nao_pago,
            "quantidade": org_qtd,
            "quantidade_pago": org_qtd_pago,
            "quantidade_nao_pago": org_qtd_nao_pago,
            "quantidade_60_dias": len(orgaos_60_dias),
            "por_ano": org_por_ano,
            "top_devedores": org_top_devedores,
        },
    })


@app.get("/api/orgaos-publicos")
@login_required
def listar_debitos_orgaos_publicos():
    q = (request.args.get("q") or "").strip()
    ano = (request.args.get("ano") or "").strip()
    status = (request.args.get("status") or "").strip().lower()
    stmt = db.select(DebitoOrgaoPublico)
    if q:
        stmt = stmt.where(or_(
            DebitoOrgaoPublico.nome_orgao.ilike(f"%{q}%"),
            DebitoOrgaoPublico.numero_nota_fiscal.ilike(f"%{q}%"),
            DebitoOrgaoPublico.numero_ordem.ilike(f"%{q}%"),
            DebitoOrgaoPublico.tipo_orgao.ilike(f"%{q}%"),
        ))
    if ano:
        try:
            ano_int = int(ano)
            stmt = stmt.where(func.extract("year", DebitoOrgaoPublico.data_debito) == ano_int)
        except ValueError:
            pass
    if status == "pago":
        stmt = stmt.where(DebitoOrgaoPublico.pago.is_(True))
    elif status in {"nao-pago", "não-pago", "nao_pago", "não_pago"}:
        stmt = stmt.where(DebitoOrgaoPublico.pago.is_(False))
    stmt = stmt.order_by(DebitoOrgaoPublico.data_debito.desc(), DebitoOrgaoPublico.nome_orgao.asc())
    registros = db.session.execute(stmt).scalars().all()
    dados = [debito_orgao_dict(r) for r in registros]
    return jsonify({
        "registros": dados,
        "resumo": {
            "quantidade": len(dados),
            "total": sum(r["valor_debito"] for r in dados),
            "total_pago": sum(r["valor_debito"] for r in dados if r["pago"]),
            "total_nao_pago": sum(r["valor_debito"] for r in dados if not r["pago"]),
        }
    })


def validar_debito_orgao_payload(data):
    nome_orgao = (data.get("nome_orgao") or "").strip()
    tipo_orgao = (data.get("tipo_orgao") or "Prefeitura").strip()
    numero_nota_fiscal = (data.get("numero_nota_fiscal") or "").strip()
    numero_ordem = (data.get("numero_ordem") or "").strip()
    try:
        data_debito = date.fromisoformat(data.get("data_debito") or "")
    except ValueError:
        return None, "Informe uma data válida para o débito."
    try:
        valor_debito = float(data.get("valor_debito", 0))
    except (TypeError, ValueError):
        return None, "Informe um valor de débito válido."
    if not nome_orgao:
        return None, "Informe o nome do órgão devedor."
    if not numero_nota_fiscal:
        return None, "Informe o número da nota fiscal."
    if valor_debito < 0:
        return None, "O valor do débito não pode ser negativo."
    return {
        "nome_orgao": nome_orgao,
        "tipo_orgao": tipo_orgao or "Outro",
        "data_debito": data_debito,
        "valor_debito": valor_debito,
        "pago": bool(data.get("pago", False)),
        "numero_nota_fiscal": numero_nota_fiscal,
        "numero_ordem": numero_ordem or None,
    }, None


@app.post("/api/orgaos-publicos")
@login_required
def criar_debito_orgao_publico():
    payload, erro = validar_debito_orgao_payload(request.get_json(silent=True) or {})
    if erro:
        return jsonify({"erro": erro}), 400
    registro = DebitoOrgaoPublico(**payload)
    db.session.add(registro)
    db.session.commit()
    return jsonify(debito_orgao_dict(registro)), 201


@app.put("/api/orgaos-publicos/<int:registro_id>")
@login_required
def atualizar_debito_orgao_publico(registro_id):
    registro = db.session.get(DebitoOrgaoPublico, registro_id)
    if not registro:
        return jsonify({"erro": "Registro não encontrado."}), 404
    payload, erro = validar_debito_orgao_payload(request.get_json(silent=True) or {})
    if erro:
        return jsonify({"erro": erro}), 400
    for campo, valor in payload.items():
        setattr(registro, campo, valor)
    db.session.commit()
    return jsonify(debito_orgao_dict(registro))


@app.patch("/api/orgaos-publicos/<int:registro_id>/status")
@login_required
def alternar_status_debito_orgao_publico(registro_id):
    registro = db.session.get(DebitoOrgaoPublico, registro_id)
    if not registro:
        return jsonify({"erro": "Registro não encontrado."}), 404
    data = request.get_json(silent=True) or {}
    if "pago" not in data:
        return jsonify({"erro": "Informe o novo status do débito."}), 400
    registro.pago = bool(data.get("pago"))
    db.session.commit()
    return jsonify(debito_orgao_dict(registro))


@app.delete("/api/orgaos-publicos/<int:registro_id>")
@login_required
def excluir_debito_orgao_publico(registro_id):
    registro = db.session.get(DebitoOrgaoPublico, registro_id)
    if not registro:
        return jsonify({"erro": "Registro não encontrado."}), 404
    db.session.delete(registro)
    db.session.commit()
    return jsonify({"ok": True})


@app.get("/api/exportar/orgaos-publicos.csv")
@login_required
def exportar_orgaos_publicos():
    registros = db.session.execute(db.select(DebitoOrgaoPublico).order_by(DebitoOrgaoPublico.data_debito.desc())).scalars().all()
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Órgão devedor", "Tipo", "Dia", "Mês", "Ano", "Valor do débito", "Situação", "Número da nota fiscal", "Ordem de compra / serviço"])
    for r in registros:
        writer.writerow([r.nome_orgao, r.tipo_orgao, r.data_debito.day, r.data_debito.month, r.data_debito.year, f"{float(r.valor_debito):.2f}", "PAGO" if r.pago else "EM ABERTO", r.numero_nota_fiscal, r.numero_ordem or ""])
    mem = io.BytesIO(output.getvalue().encode("utf-8-sig"))
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name="debitos_orgaos_publicos.csv")


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
    writer.writerow(["ID","Nome completo/Razão social","Tipo","CPF/CNPJ","RG/IE","Nascimento","Telefone","WhatsApp","E-mail","CEP","Endereço","Número","Complemento","Bairro","Cidade","UF","Dívida inicial","Previsão","Total pago","Saldo","Último pagamento","Status","Observações"])
    for c in clientes:
        d = cliente_dict(c)
        writer.writerow([d["id"],d["nome"],d["tipo_pessoa"],d["cpf_cnpj"],d["rg_ie"],d["data_nascimento"] or "",d["telefone"],d["whatsapp"],d["email"],d["cep"],d["logradouro"],d["numero"],d["complemento"],d["bairro"],d["cidade"],d["uf"],f'{d["divida"]:.2f}',d["previsao"] or "",f'{d["total_pago"]:.2f}',f'{d["saldo"]:.2f}',d["ultimo_pagamento"] or "",d["status"],d["observacoes"]])
    mem = io.BytesIO(output.getvalue().encode("utf-8-sig"))
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name="clientes.csv")


@app.get("/api/backup")
@login_required
def backup_banco():
    clientes = db.session.execute(db.select(Cliente)).scalars().all()
    pagamentos = db.session.execute(db.select(Pagamento)).scalars().all()
    orgaos_publicos = db.session.execute(db.select(DebitoOrgaoPublico)).scalars().all()
    payload = {
        "clientes": [{
            **cliente_dict(c),
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
        "orgaos_publicos": [debito_orgao_dict(r) for r in orgaos_publicos],
    }
    mem = io.BytesIO(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))
    return send_file(mem, mimetype="application/json", as_attachment=True, download_name="backup_clientes.json")


init_db()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
