"""Receitas e clientes independentes para ARCM e Saci."""
from datetime import date, datetime
from zoneinfo import ZoneInfo
from decimal import Decimal
from flask import request, jsonify, abort
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError


def registrar_receitas(app, db, login_required, valor_monetario):
    class ClienteReceita(db.Model):
        __tablename__ = 'clientes_receitas'
        id = db.Column(db.Integer, primary_key=True)
        unidade = db.Column(db.String(10), nullable=False, index=True)
        nome = db.Column(db.String(180), nullable=False)
        documento = db.Column(db.String(30))
        telefone = db.Column(db.String(30))
        email = db.Column(db.String(180))
        endereco = db.Column(db.String(500))
        observacoes = db.Column(db.String(2000))

    class Receita(db.Model):
        __tablename__ = 'receitas_unidades'
        id = db.Column(db.Integer, primary_key=True)
        unidade = db.Column(db.String(10), nullable=False, index=True)
        cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_receitas.id'), nullable=False, index=True)
        descricao = db.Column(db.String(220), nullable=False)
        categoria = db.Column(db.String(40), nullable=False)
        valor = db.Column(db.Numeric(14, 2), nullable=False)
        data = db.Column(db.Date, nullable=False, index=True)
        vencimento = db.Column(db.Date, nullable=False)
        recebida = db.Column(db.Boolean, nullable=False, default=False)
        data_recebimento = db.Column(db.Date)
        forma_pagamento = db.Column(db.String(40))
        documento = db.Column(db.String(80))
        observacoes = db.Column(db.String(2000))
        cliente = db.relationship(ClienteReceita)

    def unidade_valida(unidade):
        if unidade not in ('arcm', 'saci'):
            abort(404)

    def hoje():
        return datetime.now(ZoneInfo('America/Fortaleza')).date()

    def texto(dados, campo, limite, obrigatorio=False):
        valor = dados.get(campo) or ''
        if not isinstance(valor, str):
            raise ValueError('Confira os campos de texto.')
        valor = valor.strip()
        if len(valor) > limite or (obrigatorio and not valor):
            raise ValueError('Preencha os campos obrigatórios e respeite os limites de tamanho.')
        return valor

    def data_valida(valor):
        try:
            return date.fromisoformat(valor)
        except (TypeError, ValueError):
            raise ValueError('Informe datas válidas.')

    def payload():
        dados = request.get_json(silent=True)
        if not isinstance(dados, dict):
            raise ValueError('Dados inválidos.')
        return dados

    def cliente_dict(c):
        return {k: getattr(c, k) for k in ('id', 'unidade', 'nome', 'documento', 'telefone', 'email', 'endereco', 'observacoes')}

    def receita_dict(r):
        return dict(id=r.id, unidade=r.unidade, cliente_id=r.cliente_id, cliente_nome=r.cliente.nome,
                    descricao=r.descricao, categoria=r.categoria, valor=float(r.valor), data=r.data.isoformat(),
                    vencimento=r.vencimento.isoformat(), recebida=r.recebida,
                    status='RECEBIDA' if r.recebida else ('ATRASADA' if r.vencimento < hoje() else 'PENDENTE'),
                    data_recebimento=r.data_recebimento.isoformat() if r.data_recebimento else None,
                    forma_pagamento=r.forma_pagamento, documento=r.documento, observacoes=r.observacoes)

    @app.get('/api/receitas/<unidade>/clientes')
    @login_required
    def listar_clientes_receitas(unidade):
        unidade_valida(unidade)
        rows = db.session.execute(db.select(ClienteReceita).where(ClienteReceita.unidade == unidade).order_by(ClienteReceita.nome, ClienteReceita.id)).scalars().all()
        return jsonify([cliente_dict(c) for c in rows])

    @app.route('/api/receitas/<unidade>/clientes', methods=['POST'])
    @app.route('/api/receitas/<unidade>/clientes/<int:ident>', methods=['PUT', 'DELETE'])
    @login_required
    def salvar_cliente_receita(unidade, ident=None):
        unidade_valida(unidade)
        c = db.session.get(ClienteReceita, ident) if ident else None
        if ident and (not c or c.unidade != unidade):
            return jsonify(erro='Cliente não encontrado.'), 404
        if request.method == 'DELETE':
            vinculo = db.session.execute(db.select(Receita.id).where(Receita.cliente_id == ident).limit(1)).first()
            if vinculo:
                return jsonify(erro='Este cliente possui receitas vinculadas e não pode ser excluído.'), 409
            try:
                db.session.delete(c); db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return jsonify(erro='Este cliente possui receitas vinculadas.'), 409
            return jsonify(ok=True)
        try:
            d = payload()
            campos = {campo: texto(d, campo, limite, campo == 'nome') for campo, limite in
                      [('nome', 180), ('documento', 30), ('telefone', 30), ('email', 180), ('endereco', 500), ('observacoes', 2000)]}
            if not c:
                c = ClienteReceita(unidade=unidade); db.session.add(c)
            for campo, valor in campos.items():
                setattr(c, campo, valor)
            db.session.commit()
            return jsonify(cliente_dict(c)), 200 if ident else 201
        except ValueError as e:
            db.session.rollback(); return jsonify(erro=str(e)), 400

    @app.get('/api/receitas/<unidade>')
    @login_required
    def listar_receitas(unidade):
        unidade_valida(unidade)
        try:
            mes = request.args.get('mes') or hoje().strftime('%Y-%m')
            inicio = data_valida(mes + '-01')
            fim = date(inicio.year + (inicio.month == 12), inicio.month % 12 + 1, 1)
            stmt = db.select(Receita).where(Receita.unidade == unidade, Receita.data >= inicio, Receita.data < fim)
            cliente_id = request.args.get('cliente_id')
            if cliente_id:
                stmt = stmt.where(Receita.cliente_id == int(cliente_id))
            situacao = request.args.get('status', '')
            if situacao not in ('', 'recebida', 'pendente', 'atrasada'):
                raise ValueError('Situação inválida.')
            if situacao:
                stmt = stmt.where(Receita.recebida.is_(situacao == 'recebida'))
            if situacao == 'atrasada':
                stmt = stmt.where(Receita.vencimento < hoje())
            busca = (request.args.get('q') or '').strip()
            if busca:
                stmt = stmt.join(ClienteReceita).where(or_(Receita.descricao.ilike('%'+busca+'%'), ClienteReceita.nome.ilike('%'+busca+'%'), Receita.documento.ilike('%'+busca+'%')))
            rows = db.session.execute(stmt.order_by(Receita.data.desc(), Receita.id.desc())).scalars().all()
            total = sum((r.valor for r in rows), Decimal(0))
            recebido = sum((r.valor for r in rows if r.recebida), Decimal(0))
            atraso = sum((r.valor for r in rows if not r.recebida and r.vencimento < hoje()), Decimal(0))
            return jsonify(registros=[receita_dict(r) for r in rows], resumo=dict(total=float(total), recebido=float(recebido), pendente=float(total-recebido), atrasado=float(atraso), quantidade=len(rows)))
        except (ValueError, OverflowError) as e:
            return jsonify(erro='Confira o mês e os filtros informados.'), 400

    @app.route('/api/receitas/<unidade>', methods=['POST'])
    @app.route('/api/receitas/<unidade>/<int:ident>', methods=['PUT', 'DELETE'])
    @login_required
    def salvar_receita(unidade, ident=None):
        unidade_valida(unidade)
        r = db.session.get(Receita, ident) if ident else None
        if ident and (not r or r.unidade != unidade):
            return jsonify(erro='Receita não encontrada.'), 404
        if request.method == 'DELETE':
            db.session.delete(r); db.session.commit(); return jsonify(ok=True)
        try:
            d = payload()
            cid = d.get('cliente_id')
            if type(cid) is not int:
                raise ValueError('Selecione um cliente.')
            c = db.session.get(ClienteReceita, cid)
            if not c or c.unidade != unidade:
                raise ValueError('Selecione um cliente desta unidade.')
            campos = {campo: texto(d, campo, limite, campo in ('descricao', 'categoria')) for campo, limite in
                      [('descricao', 220), ('categoria', 40), ('forma_pagamento', 40), ('documento', 80), ('observacoes', 2000)]}
            if campos['categoria'] not in ('Vendas', 'Serviços', 'Outras receitas'):
                raise ValueError('Selecione uma categoria válida.')
            if campos['forma_pagamento'] not in ('', 'Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Boleto', 'Outro'):
                raise ValueError('Forma de pagamento inválida.')
            valor = valor_monetario(d.get('valor'))
            if valor <= 0:
                raise ValueError('O valor deve ser maior que zero.')
            recebida = d.get('recebida', False)
            if type(recebida) is not bool:
                raise ValueError('Situação inválida.')
            data_recebimento = data_valida(d.get('data_recebimento')) if recebida else None
            if data_recebimento and data_recebimento > hoje():
                raise ValueError('A data do recebimento não pode ser futura.')
            campos.update(cliente_id=cid, valor=valor, data=data_valida(d.get('data')), vencimento=data_valida(d.get('vencimento')), recebida=recebida, data_recebimento=data_recebimento)
            if not r:
                r = Receita(unidade=unidade); db.session.add(r)
            for campo, valor in campos.items():
                setattr(r, campo, valor)
            db.session.commit()
            return jsonify(receita_dict(r)), 200 if ident else 201
        except (ValueError, IntegrityError) as e:
            db.session.rollback()
            return jsonify(erro=str(e) if isinstance(e, ValueError) else 'Cliente indisponível. Atualize os cadastros.'), 400

    def backup_receitas():
        clientes = db.session.execute(db.select(ClienteReceita).order_by(ClienteReceita.id)).scalars().all()
        receitas = db.session.execute(db.select(Receita).order_by(Receita.id)).scalars().all()
        return dict(clientes_receitas=[cliente_dict(c) for c in clientes], receitas_unidades=[receita_dict(r) for r in receitas])

    return backup_receitas
