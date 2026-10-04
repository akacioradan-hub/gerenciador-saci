"""Receitas e clientes independentes para ARCM e Saci."""
from datetime import date, datetime, timedelta
from calendar import monthrange
from zoneinfo import ZoneInfo
from decimal import Decimal
from flask import request, jsonify, abort
from sqlalchemy import or_, inspect, text
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

    class ContratoReceita(db.Model):
        __tablename__ = 'contratos_receitas_arcm'
        id = db.Column(db.Integer, primary_key=True)
        numero = db.Column(db.String(80), nullable=False, unique=True)
        cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_receitas.id'), nullable=False)
        tipo_pagamento = db.Column(db.String(15), nullable=False)
        prazo_meses = db.Column(db.Integer, nullable=False)
        inicio = db.Column(db.Date, nullable=False)
        fim = db.Column(db.Date, nullable=False)
        primeiro_vencimento = db.Column(db.Date, nullable=False)
        valor_parcela = db.Column(db.Numeric(14, 2), nullable=False)
        parcelas = db.Column(db.Integer, nullable=False)

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
        contrato_id = db.Column(db.Integer, db.ForeignKey('contratos_receitas_arcm.id'), nullable=True)
        parcela = db.Column(db.Integer, nullable=True)
        contrato = db.relationship(ContratoReceita)

    def adicionar_meses(dia, meses):
        ano, mes = divmod(dia.year * 12 + dia.month - 1 + meses, 12)
        return date(ano, mes + 1, min(dia.day, monthrange(ano, mes + 1)[1]))

    def migrar_receitas():
        colunas = {c['name'] for c in inspect(db.engine).get_columns('receitas_unidades')}
        for nome, tipo in [('contrato_id', 'INTEGER REFERENCES contratos_receitas_arcm(id)'), ('parcela', 'INTEGER')]:
            if nome not in colunas:
                db.session.execute(text(f'ALTER TABLE receitas_unidades ADD COLUMN {nome} {tipo}'))
        db.session.commit()

    def contrato_dict(c):
        return dict(id=c.id, numero=c.numero, cliente_id=c.cliente_id, tipo_pagamento=c.tipo_pagamento,
                    prazo_meses=c.prazo_meses, inicio=c.inicio.isoformat(), fim=c.fim.isoformat(),
                    primeiro_vencimento=c.primeiro_vencimento.isoformat(), valor_parcela=float(c.valor_parcela), parcelas=c.parcelas)

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
                    forma_pagamento=r.forma_pagamento, documento=r.documento, observacoes=r.observacoes,
                    contrato=contrato_dict(r.contrato) if r.contrato else None, parcela=r.parcela)

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
            contrato_vinculado = db.session.execute(db.select(ContratoReceita.id).where(ContratoReceita.cliente_id == ident).limit(1)).first()
            if vinculo or contrato_vinculado:
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
                stmt = stmt.join(ClienteReceita).outerjoin(ContratoReceita, Receita.contrato_id == ContratoReceita.id).where(or_(Receita.descricao.ilike('%'+busca+'%'), ClienteReceita.nome.ilike('%'+busca+'%'), Receita.documento.ilike('%'+busca+'%'), ContratoReceita.numero.ilike('%'+busca+'%')))
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
            if r and r.contrato and cid != r.contrato.cliente_id:
                raise ValueError('O cliente da parcela deve ser o cliente do contrato.')
            if not r and unidade == 'arcm':
                tipo = d.get('tipo_pagamento', 'avista')
                intervalos = {'avista': 0, 'mensal': 1, 'trimestral': 3, 'semestral': 6, 'anual': 12}
                if not isinstance(tipo, str) or tipo not in intervalos:
                    raise ValueError('Tipo de pagamento inválido.')
                numero = texto(d, 'numero_contrato', 80, tipo != 'avista').upper()
                if numero:
                    prazo = d.get('prazo_meses')
                    if type(prazo) is not int or not 1 <= prazo <= 600:
                        raise ValueError('Informe um prazo de contrato entre 1 e 600 meses.')
                    inicio = data_valida(d.get('inicio_contrato'))
                    fim = adicionar_meses(inicio, prazo) - timedelta(days=1)
                    passo = intervalos[tipo]
                    quantidade = (prazo + passo - 1) // passo if passo else 1
                    datas = [adicionar_meses(campos['vencimento'], i * passo) for i in range(quantidade)]
                    if datas[0] < inicio or datas[-1] > fim:
                        raise ValueError('Os vencimentos precisam estar dentro do período do contrato. Confira início, prazo e primeiro vencimento.')
                    if db.session.execute(db.select(ContratoReceita.id).where(ContratoReceita.numero == numero)).first():
                        return jsonify(erro='Já existe um contrato com este número. Consulte as receitas existentes.'), 409
                    contrato = ContratoReceita(numero=numero, cliente_id=cid, tipo_pagamento=tipo, prazo_meses=prazo,
                                              inicio=inicio, fim=fim, primeiro_vencimento=datas[0],
                                              valor_parcela=campos['valor'], parcelas=quantidade)
                    db.session.add(contrato); db.session.flush()
                    registros = []
                    for i, vencimento in enumerate(datas):
                        parcela_campos = dict(campos)
                        parcela_campos.update(data=vencimento if passo else campos['data'], vencimento=vencimento,
                                              recebida=campos['recebida'] if i == 0 else False,
                                              data_recebimento=campos['data_recebimento'] if i == 0 else None)
                        item = Receita(unidade=unidade, contrato_id=contrato.id, parcela=i+1, **parcela_campos)
                        db.session.add(item); registros.append(item)
                    db.session.commit()
                    return jsonify(**receita_dict(registros[0]), parcelas_criadas=quantidade,
                                   total_previsto=float(contrato.valor_parcela * quantidade)), 201
            if not r:
                r = Receita(unidade=unidade); db.session.add(r)
            for campo, valor in campos.items():
                setattr(r, campo, valor)
            db.session.commit()
            return jsonify(receita_dict(r)), 200 if ident else 201
        except (ValueError, OverflowError, IntegrityError) as e:
            db.session.rollback()
            return jsonify(erro=str(e) if isinstance(e, ValueError) else 'Não foi possível salvar. Confira se o número do contrato já existe e atualize os cadastros.'), 400

    @app.get('/api/receitas/arcm/previsao')
    @login_required
    def previsao_receitas_arcm():
        try:
            inicio = data_valida((request.args.get('mes') or hoje().strftime('%Y-%m')) + '-01')
            fim = adicionar_meses(inicio, 12)
            stmt = db.select(Receita).where(Receita.unidade == 'arcm', Receita.vencimento >= inicio, Receita.vencimento < fim)
            if request.args.get('cliente_id'):
                stmt = stmt.where(Receita.cliente_id == int(request.args['cliente_id']))
            rows = db.session.execute(stmt).scalars().all()
            meses = []
            for i in range(12):
                mes = adicionar_meses(inicio, i).strftime('%Y-%m')
                previstas = [r for r in rows if r.vencimento.strftime('%Y-%m') == mes]
                recebido = sum((r.valor for r in previstas if r.recebida), Decimal(0))
                pendente = sum((r.valor for r in previstas if not r.recebida), Decimal(0))
                meses.append(dict(mes=mes, recebido=float(recebido), pendente=float(pendente), total=float(recebido+pendente)))
            return jsonify(meses=meses)
        except (ValueError, OverflowError):
            return jsonify(erro='Confira o mês e o cliente da previsão.'), 400

    @app.patch('/api/receitas/<unidade>/<int:ident>/status')
    @login_required
    def status_receita(unidade, ident):
        unidade_valida(unidade)
        r = db.session.get(Receita, ident)
        if not r or r.unidade != unidade:
            return jsonify(erro='Receita não encontrada.'), 404
        try:
            d = payload()
            recebida = d.get('recebida')
            if type(recebida) is not bool:
                raise ValueError('Informe a situação da receita.')
            data = data_valida(d.get('data_recebimento')) if recebida else None
            if data and data > hoje():
                raise ValueError('A data do recebimento não pode ser futura.')
            r.recebida = recebida
            r.data_recebimento = data
            db.session.commit()
            return jsonify(receita_dict(r))
        except ValueError as e:
            db.session.rollback()
            return jsonify(erro=str(e)), 400

    def backup_receitas():
        clientes = db.session.execute(db.select(ClienteReceita).order_by(ClienteReceita.id)).scalars().all()
        receitas = db.session.execute(db.select(Receita).order_by(Receita.id)).scalars().all()
        contratos = db.session.execute(db.select(ContratoReceita).order_by(ContratoReceita.id)).scalars().all()
        return dict(clientes_receitas=[cliente_dict(c) for c in clientes], receitas_unidades=[receita_dict(r) for r in receitas], contratos_receitas_arcm=[contrato_dict(c) for c in contratos])

    return backup_receitas, migrar_receitas
