"""Contas a pagar e cadastros vinculados; usa o banco central da aplicação."""
import csv
import io
from calendar import monthrange
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from decimal import Decimal, InvalidOperation
from flask import request, jsonify, send_file, session
from sqlalchemy import or_, func, inspect, text, case
from sqlalchemy.exc import IntegrityError


def registrar_despesas(app, db, login_required):
    class Funcionario(db.Model):
        __tablename__ = 'funcionarios_despesas'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(180), nullable=False)
        cargo = db.Column(db.String(100))
        data_nascimento = db.Column(db.Date)
        endereco = db.Column(db.String(500))
        telefone = db.Column(db.String(30))
        observacoes = db.Column(db.Text)

    class Veiculo(db.Model):
        __tablename__ = 'veiculos_despesas'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(180), nullable=False)
        placa = db.Column(db.String(10), nullable=False, unique=True)
        ano = db.Column(db.Integer)
        observacoes = db.Column(db.Text)

    class Fornecedor(db.Model):
        __tablename__ = 'fornecedores_despesas'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(180), nullable=False)
        documento = db.Column(db.String(30))
        telefone = db.Column(db.String(30))
        observacoes = db.Column(db.Text)

    class Terceirizado(db.Model):
        __tablename__ = 'terceirizados_despesas'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(180), nullable=False)
        servico = db.Column(db.String(100))
        documento = db.Column(db.String(30))
        telefone = db.Column(db.String(30))
        observacoes = db.Column(db.Text)

    class RecorrenciaDespesa(db.Model):
        __tablename__ = 'recorrencias_despesas'
        id = db.Column(db.Integer, primary_key=True)
        ativa = db.Column(db.Boolean, nullable=False, default=True)
        proxima_competencia = db.Column(db.String(7), nullable=False)
        dia_vencimento = db.Column(db.Integer, nullable=False)

    class Despesa(db.Model):
        __tablename__ = 'despesas_mensais'
        id = db.Column(db.Integer, primary_key=True)
        descricao = db.Column(db.String(220), nullable=False)
        grupo = db.Column(db.String(30), nullable=False)
        categoria = db.Column(db.String(100), nullable=False)
        competencia = db.Column(db.String(7), nullable=False, index=True)
        vencimento = db.Column(db.Date, nullable=False, index=True)
        valor = db.Column(db.Numeric(14, 2), nullable=False)
        valor_base = db.Column(db.Numeric(14, 2))
        recorrencia_id = db.Column(db.Integer, db.ForeignKey('recorrencias_despesas.id'))
        recorrencia = db.relationship(RecorrenciaDespesa)
        __table_args__ = (db.Index('ix_desp_recorrencia_competencia', 'recorrencia_id', 'competencia', unique=True),)
        prioridade = db.Column(db.String(20), nullable=False, default='Normal')
        pago = db.Column(db.Boolean, nullable=False, default=False)
        data_pagamento = db.Column(db.Date)
        documento = db.Column(db.String(100))
        observacoes = db.Column(db.Text)
        funcionario_id = db.Column(db.Integer, db.ForeignKey('funcionarios_despesas.id', ondelete='RESTRICT'), index=True)
        veiculo_id = db.Column(db.Integer, db.ForeignKey('veiculos_despesas.id', ondelete='RESTRICT'), index=True)
        fornecedor_id = db.Column(db.Integer, db.ForeignKey('fornecedores_despesas.id', ondelete='RESTRICT'), index=True)
        funcionario = db.relationship(Funcionario)
        veiculo = db.relationship(Veiculo)
        fornecedor = db.relationship(Fornecedor)
        terceirizado_id = db.Column(db.Integer, db.ForeignKey("terceirizados_despesas.id", ondelete="RESTRICT"), index=True)
        terceirizado = db.relationship(Terceirizado)
        criado_em = db.Column(db.DateTime, server_default=func.now(), nullable=False)

    modelos = {'funcionarios': Funcionario, 'veiculos': Veiculo, 'fornecedores': Fornecedor, 'terceirizados': Terceirizado}
    grupos = ('Custos fixos', 'Fornecedores', 'Despesas variáveis')
    prioridades = ('Baixa', 'Normal', 'Alta', 'Urgente')

    def hoje():
        return datetime.now(ZoneInfo('America/Fortaleza')).date()

    def proximo_mes(competencia):
        dia = date.fromisoformat(competencia + '-01')
        return date(dia.year + (dia.month == 12), dia.month % 12 + 1, 1).strftime('%Y-%m')

    def valor_base(r):
        return r.valor_base if r.valor_base is not None else r.valor

    def prioridade_efetiva(r):
        return 'Urgente' if not r.pago and r.vencimento < hoje() else r.prioridade

    def nova_recorrencia(r):
        serie = RecorrenciaDespesa(ativa=True, proxima_competencia=proximo_mes(r.competencia), dia_vencimento=r.vencimento.day)
        db.session.add(serie)
        r.recorrencia = serie

    def gerar_recorrentes():
        atual = hoje().strftime('%Y-%m')
        series = db.session.execute(db.select(RecorrenciaDespesa).where(
            RecorrenciaDespesa.ativa.is_(True), RecorrenciaDespesa.proxima_competencia <= atual
        ).order_by(RecorrenciaDespesa.id).with_for_update()).scalars().all()
        for serie in series:
            modelo = db.session.execute(db.select(Despesa).where(Despesa.recorrencia_id == serie.id)
                .order_by(Despesa.competencia.desc(), Despesa.id.desc()).limit(1)).scalar_one_or_none()
            if modelo is None:
                serie.ativa = False
                continue
            while serie.proxima_competencia <= atual:
                competencia = serie.proxima_competencia
                existente = db.session.execute(db.select(Despesa.id).where(
                    Despesa.recorrencia_id == serie.id, Despesa.competencia == competencia)).first()
                if not existente:
                    ano, mes_num = map(int, competencia.split('-'))
                    campos = {c:getattr(modelo, c) for c in ('descricao','grupo','categoria','prioridade',
                        'funcionario_id','veiculo_id','fornecedor_id','terceirizado_id','observacoes')}
                    db.session.add(Despesa(**campos, competencia=competencia,
                        vencimento=date(ano, mes_num, min(serie.dia_vencimento, monthrange(ano, mes_num)[1])),
                        valor=valor_base(modelo), valor_base=valor_base(modelo), pago=False, data_pagamento=None,
                        documento='', recorrencia_id=serie.id))
                serie.proxima_competencia = proximo_mes(competencia)
        db.session.commit()

    @app.before_request
    def atualizar_custos_fixos():
        # Gera as competências vencidas até o mês atual no primeiro acesso autenticado.
        if request.method == 'GET' and session.get('user_id') and (request.path == '/' or request.path.startswith('/api/')):
            try:
                gerar_recorrentes()
            except IntegrityError:
                # A chave única protege a geração concorrente em mais de uma requisição.
                db.session.rollback()

    def texto(dados, campo, limite=220):
        v = dados.get(campo) or ''
        if not isinstance(v, str) or len(v.strip()) > limite:
            raise ValueError(f'Campo {campo} inválido ou muito longo.')
        return v.strip()

    def mes(valor):
        if not isinstance(valor, str) or len(valor) != 7:
            raise ValueError('Informe o mês de competência.')
        date.fromisoformat(valor + '-01')
        return valor

    def cadastro_dict(r):
        campos = ('nome', 'cargo', 'servico', 'telefone', 'placa', 'ano', 'documento', 'observacoes')
        dados = {'id': r.id, **{c: getattr(r, c) for c in campos if hasattr(r, c)}}
        if isinstance(r, Funcionario):
            dados.update(data_nascimento=r.data_nascimento.isoformat() if r.data_nascimento else None, endereco=r.endereco or '')
        return dados

    def despesa_dict(r):
        return {'id': r.id, 'descricao': r.descricao, 'grupo': r.grupo, 'categoria': r.categoria,
                'competencia': r.competencia, 'vencimento': r.vencimento.isoformat(), 'valor': float(r.valor),
                'prioridade': prioridade_efetiva(r), 'prioridade_cadastro': r.prioridade, 'pago': r.pago,
                'urgente_automatico': not r.pago and r.vencimento < hoje(),
                'valor_base': float(valor_base(r)), 'juros': float(r.valor - valor_base(r)),
                'recorrencia_id': r.recorrencia_id, 'repetir_mensal': bool(r.recorrencia and r.recorrencia.ativa),
                'data_pagamento': r.data_pagamento.isoformat() if r.data_pagamento else None,
                'documento': r.documento, 'observacoes': r.observacoes,
                'funcionario_id': r.funcionario_id, 'veiculo_id': r.veiculo_id, 'fornecedor_id': r.fornecedor_id, 'terceirizado_id': r.terceirizado_id,
                'funcionario_nome': r.funcionario.nome if r.funcionario else '',
                'veiculo_nome': f'{r.veiculo.nome} · {r.veiculo.placa}' if r.veiculo else '',
                'fornecedor_nome': r.fornecedor.nome if r.fornecedor else '',
                'terceirizado_nome': r.terceirizado.nome if r.terceirizado else '',
                'status': 'PAGO' if r.pago else ('ATRASADO' if r.vencimento < hoje() else 'EM ABERTO')}

    def validar(d):
        p = {c: texto(d, c, n) for c, n in [('descricao', 220), ('categoria', 100), ('grupo', 30),
             ('prioridade', 20), ('documento', 100), ('observacoes', 5000)]}
        if not p['descricao'] or not p['categoria']:
            raise ValueError('Informe descrição e categoria.')
        if p['grupo'] not in grupos or p['prioridade'] not in prioridades:
            raise ValueError('Grupo ou prioridade inválidos.')
        p['competencia'] = mes(d.get('competencia'))
        p['vencimento'] = date.fromisoformat(d.get('vencimento') or '')
        valor = Decimal(str(d.get('valor')))
        if not valor.is_finite() or valor <= 0 or valor >= Decimal('1000000000000') or valor != valor.quantize(Decimal('.01')):
            raise ValueError('Informe um valor positivo com até duas casas decimais.')
        p['valor'] = valor
        if not isinstance(d.get('pago', False), bool):
            raise ValueError('Situação de pagamento inválida.')
        p['pago'] = d.get('pago', False)
        p['data_pagamento'] = date.fromisoformat(d.get('data_pagamento') or '') if p['pago'] else None
        if p['data_pagamento'] and p['data_pagamento'] > hoje():
            raise ValueError('A data do pagamento não pode ser futura.')
        for tipo, campo in [('funcionarios', 'funcionario_id'), ('veiculos', 'veiculo_id'), ('fornecedores', 'fornecedor_id'), ('terceirizados', 'terceirizado_id')]:
            ident = d.get(campo)
            p[campo] = int(ident) if ident else None
            if p[campo] and not db.session.get(modelos[tipo], p[campo]):
                raise ValueError('Cadastro vinculado não encontrado.')
        if p['grupo'] == 'Fornecedores' and not p['fornecedor_id']:
            raise ValueError('Selecione o fornecedor.')
        return p

    def consultar():
        competencia = mes(request.args.get('mes') or hoje().strftime('%Y-%m'))
        stmt = db.select(Despesa).where(Despesa.competencia == competencia)
        for campo in ('grupo', 'categoria', 'prioridade', 'funcionario_id', 'veiculo_id', 'fornecedor_id', 'terceirizado_id'):
            valor = request.args.get(campo)
            if valor:
                if campo.endswith('_id'):
                    valor = int(valor)
                if campo == 'prioridade':
                    prioridade = case(((Despesa.pago.is_(False)) & (Despesa.vencimento < hoje()), 'Urgente'), else_=Despesa.prioridade)
                    stmt = stmt.where(prioridade == valor)
                else:
                    stmt = stmt.where(getattr(Despesa, campo) == valor)
        status = request.args.get('status')
        if status == 'pago': stmt = stmt.where(Despesa.pago.is_(True))
        elif status == 'aberto': stmt = stmt.where(Despesa.pago.is_(False))
        elif status == 'atrasado': stmt = stmt.where(Despesa.pago.is_(False), Despesa.vencimento < hoje())
        busca = request.args.get('q', '').strip()
        if busca:
            stmt = stmt.where(or_(Despesa.descricao.ilike(f'%{busca}%'), Despesa.categoria.ilike(f'%{busca}%'), Despesa.documento.ilike(f'%{busca}%')))
        return db.session.execute(stmt.order_by(Despesa.vencimento, Despesa.id)).scalars().all()

    @app.get('/api/despesas/cadastros')
    @login_required
    def cadastros_despesas():
        return jsonify({tipo: [cadastro_dict(r) for r in db.session.execute(db.select(modelo).order_by(modelo.nome)).scalars()]
                        for tipo, modelo in modelos.items()})

    @app.route('/api/despesas/cadastros/<tipo>', methods=['POST'])
    @app.route('/api/despesas/cadastros/<tipo>/<int:ident>', methods=['PUT', 'DELETE'])
    @login_required
    def salvar_cadastro_despesa(tipo, ident=None):
        modelo = modelos.get(tipo)
        if not modelo: return jsonify(erro='Tipo de cadastro inválido.'), 404
        r = db.session.get(modelo, ident) if ident else modelo()
        if r is None: return jsonify(erro='Cadastro não encontrado.'), 404
        if request.method == 'DELETE':
            campo = {'funcionarios': Despesa.funcionario_id, 'veiculos': Despesa.veiculo_id, 'fornecedores': Despesa.fornecedor_id, 'terceirizados': Despesa.terceirizado_id}[tipo]
            if db.session.execute(db.select(Despesa.id).where(campo == ident).limit(1)).first():
                return jsonify(erro='Este cadastro possui despesas vinculadas. Mantenha-o para preservar o histórico.'), 409
            db.session.delete(r); db.session.commit()
            return jsonify(ok=True)
        try:
            d = request.get_json(silent=True) or {}
            nome = texto(d, 'nome', 180)
            if not nome: raise ValueError('Informe o nome.')
            r.nome = nome; r.observacoes = texto(d, 'observacoes', 5000)
            if tipo == 'veiculos':
                r.placa = texto(d, 'placa', 10).upper().replace('-', '').replace(' ', '')
                if not r.placa or not r.placa.isalnum(): raise ValueError('Informe uma placa válida.')
                r.ano = int(d['ano']) if d.get('ano') else None
                if r.ano and not 1900 <= r.ano <= 2100: raise ValueError('Ano inválido.')
            else:
                r.telefone = texto(d, 'telefone', 30)
                if tipo == 'funcionarios':
                    r.cargo = texto(d, 'cargo', 100)
                    if 'data_nascimento' in d:
                        r.data_nascimento = date.fromisoformat(d['data_nascimento']) if d.get('data_nascimento') else None
                        if r.data_nascimento and r.data_nascimento > datetime.now(ZoneInfo('America/Fortaleza')).date():
                            raise ValueError('A data de nascimento não pode estar no futuro.')
                    if 'endereco' in d: r.endereco = texto(d, 'endereco', 500)
                else: r.documento = texto(d, 'documento', 30)
                if tipo == 'terceirizados': r.servico = texto(d, 'servico', 100)
            db.session.add(r); db.session.commit()
            return jsonify(cadastro_dict(r)), 200 if ident else 201
        except (ValueError, TypeError):
            db.session.rollback(); return jsonify(erro='Confira nome, datas, limites dos campos e ano/placa válidos.'), 400
        except IntegrityError:
            db.session.rollback(); return jsonify(erro='Já existe um veículo com esta placa.'), 409

    @app.get('/api/despesas')
    @login_required
    def listar_despesas():
        try: registros = consultar()
        except (ValueError, TypeError): return jsonify(erro='Filtro de mês ou cadastro inválido.'), 400
        total = sum((r.valor for r in registros), Decimal(0))
        pago = sum((r.valor for r in registros if r.pago), Decimal(0))
        atrasado = sum((r.valor for r in registros if not r.pago and r.vencimento < hoje()), Decimal(0))
        por_grupo = {g: float(sum((r.valor for r in registros if r.grupo == g), Decimal(0))) for g in grupos}
        return jsonify(registros=[despesa_dict(r) for r in registros], resumo={
            'total': float(total), 'pago': float(pago), 'aberto': float(total-pago),
            'atrasado': float(atrasado), 'quantidade': len(registros), 'por_grupo': por_grupo})

    @app.route('/api/despesas', methods=['POST'])
    @app.route('/api/despesas/<int:ident>', methods=['PUT', 'DELETE'])
    @login_required
    def salvar_despesa(ident=None):
        r = db.session.get(Despesa, ident) if ident else Despesa()
        if r is None: return jsonify(erro='Despesa não encontrada.'), 404
        if request.method == 'DELETE':
            if r.recorrencia: r.recorrencia.ativa = False
            db.session.delete(r); db.session.commit(); return jsonify(ok=True)
        dados = request.get_json(silent=True) or {}
        try:
            p = validar(dados)
            repetir = dados.get('repetir_mensal', bool(r.recorrencia and r.recorrencia.ativa) if ident else p['grupo'] == 'Custos fixos')
            if not isinstance(repetir, bool): raise ValueError('Repetição mensal inválida.')
            if p['grupo'] != 'Custos fixos': repetir = False
            if r.recorrencia_id and p['competencia'] != r.competencia:
                raise ValueError('Mantenha a competência da despesa recorrente. Cadastre outra despesa para outro mês.')
            if repetir: proximo_mes(p['competencia'])
        except (ValueError, TypeError, InvalidOperation, OverflowError) as exc:
            return jsonify(erro=str(exc) if isinstance(exc, ValueError) else 'Confira datas, vínculos e valor da despesa.'), 400
        base_anterior = valor_base(r) if ident else p['valor']
        if ident and r.pago and not p['pago'] and p['valor'] == r.valor:
            p['valor'] = base_anterior
        r.valor_base = min(base_anterior, p['valor']) if ident and p['pago'] else p['valor']
        dia_alterado = not ident or r.vencimento != p['vencimento']
        for c, v in p.items(): setattr(r, c, v)
        if r.recorrencia:
            if repetir and not r.recorrencia.ativa:
                r.recorrencia.proxima_competencia = max(proximo_mes(r.competencia), proximo_mes(hoje().strftime('%Y-%m')))
            r.recorrencia.ativa = repetir
            if dia_alterado: r.recorrencia.dia_vencimento = r.vencimento.day
        elif repetir:
            nova_recorrencia(r)
        db.session.add(r); db.session.commit()
        return jsonify(despesa_dict(r)), 200 if ident else 201

    @app.patch('/api/despesas/<int:ident>/status')
    @login_required
    def status_despesa(ident):
        r = db.session.get(Despesa, ident)
        if r is None: return jsonify(erro='Despesa não encontrada.'), 404
        d = request.get_json(silent=True) or {}
        if not isinstance(d.get('pago'), bool): return jsonify(erro='Informe Pago ou Em aberto.'), 400
        try: data = date.fromisoformat(d.get('data_pagamento') or '') if d['pago'] else None
        except (ValueError, TypeError): return jsonify(erro='Informe a data de pagamento.'), 400
        try:
            base = valor_base(r)
            valor = Decimal(str(d.get('valor', r.valor))) if d['pago'] else base
            if not valor.is_finite() or valor < base or valor >= Decimal('1000000000000') or valor != valor.quantize(Decimal('.01')):
                raise ValueError('O total pago deve ser igual ou maior que o valor base, com até duas casas decimais.')
            if data and data > hoje(): raise ValueError('A data do pagamento não pode ser futura.')
        except (InvalidOperation, TypeError, ValueError) as exc:
            return jsonify(erro=str(exc) if isinstance(exc, ValueError) else 'Informe um valor de pagamento válido.'), 400
        r.valor_base = base; r.valor = valor
        r.pago = d['pago']; r.data_pagamento = data; db.session.commit()
        return jsonify(despesa_dict(r))

    @app.get('/api/exportar/despesas.csv')
    @login_required
    def exportar_despesas():
        try: registros = consultar()
        except (ValueError, TypeError): return jsonify(erro='Filtro inválido.'), 400
        out = io.StringIO(); writer = csv.writer(out, delimiter=';')
        writer.writerow(['Competência','Descrição','Grupo','Categoria','Fornecedor','Funcionário','Veículo','Terceirizado','Prioridade','Vencimento','Valor','Situação','Pagamento','Documento','Observações','Valor base','Juros / acréscimos','Repetição mensal'])
        for r in registros:
            d = despesa_dict(r)
            row = [r.competencia,r.descricao,r.grupo,r.categoria,d['fornecedor_nome'],d['funcionario_nome'],d['veiculo_nome'],d['terceirizado_nome'],d['prioridade'],r.vencimento.isoformat(),f'{r.valor:.2f}',d['status'],d['data_pagamento'] or '',r.documento or '',r.observacoes or '',f'{valor_base(r):.2f}',f'{r.valor-valor_base(r):.2f}','Sim' if d['repetir_mensal'] else 'Não']
            writer.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in row])
        return send_file(io.BytesIO(out.getvalue().encode('utf-8-sig')), mimetype='text/csv', as_attachment=True, download_name='despesas_mes.csv')

    def backup():
        return {'recorrencias_despesas': [dict(id=r.id, ativa=r.ativa, proxima_competencia=r.proxima_competencia, dia_vencimento=r.dia_vencimento) for r in db.session.execute(db.select(RecorrenciaDespesa)).scalars()],
                'despesas_mensais': [despesa_dict(r) for r in db.session.execute(db.select(Despesa)).scalars()],
                **{tipo: [cadastro_dict(r) for r in db.session.execute(db.select(modelo)).scalars()] for tipo, modelo in modelos.items()}}
    def migrar():
        # create_all cria a nova tabela; adiciona somente a coluna nas despesas antigas.
        colunas = {c['name'] for c in inspect(db.engine).get_columns('despesas_mensais')}
        instalar_repeticao = 'recorrencia_id' not in colunas
        with db.engine.begin() as conn:
            if 'valor_base' not in colunas:
                conn.execute(text('ALTER TABLE despesas_mensais ADD COLUMN valor_base NUMERIC(14, 2)'))
            if instalar_repeticao:
                conn.execute(text('ALTER TABLE despesas_mensais ADD COLUMN recorrencia_id INTEGER REFERENCES recorrencias_despesas(id)'))
            conn.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS ix_desp_recorrencia_competencia ON despesas_mensais (recorrencia_id, competencia)'))
        if instalar_repeticao:
            # Ativa o último mês de custos fixos existente; meses anteriores são histórico.
            ultimo = db.session.execute(db.select(func.max(Despesa.competencia)).where(
                Despesa.grupo == 'Custos fixos', Despesa.competencia <= hoje().strftime('%Y-%m'))).scalar_one()
            if ultimo:
                for r in db.session.execute(db.select(Despesa).where(Despesa.grupo == 'Custos fixos', Despesa.competencia == ultimo)).scalars():
                    nova_recorrencia(r)
                    # Na atualização inicial, não inventa contas de meses antigos ausentes.
                    r.recorrencia.proxima_competencia = max(r.recorrencia.proxima_competencia, hoje().strftime('%Y-%m'))
                db.session.commit()
        if 'terceirizado_id' not in colunas:
            with db.engine.begin() as conn:
                conn.execute(text('ALTER TABLE despesas_mensais ADD COLUMN terceirizado_id INTEGER REFERENCES terceirizados_despesas(id) ON DELETE RESTRICT'))
        with db.engine.begin() as conn:
            conn.execute(text('CREATE INDEX IF NOT EXISTS ix_despesas_mensais_terceirizado_id ON despesas_mensais (terceirizado_id)'))
        colunas_funcionario = {c['name'] for c in inspect(db.engine).get_columns('funcionarios_despesas')}
        with db.engine.begin() as conn:
            for nome,tipo in [('data_nascimento','DATE'),('endereco','VARCHAR(500)')]:
                if nome not in colunas_funcionario:
                    conn.execute(text(f'ALTER TABLE funcionarios_despesas ADD COLUMN {nome} {tipo}'))

    def aniversarios_amanha(hoje=None):
        hoje = hoje or datetime.now(ZoneInfo('America/Fortaleza')).date()
        amanha = hoje + timedelta(days=1)
        avisos = []
        registros = db.session.execute(db.select(Funcionario).where(Funcionario.data_nascimento.is_not(None)).order_by(Funcionario.nome)).scalars()
        for r in registros:
            nascimento = r.data_nascimento
            try: aniversario = date(amanha.year,nascimento.month,nascimento.day)
            except ValueError: aniversario = date(amanha.year,3,1)  # 29/02 em ano não bissexto.
            if aniversario == amanha and amanha.year > nascimento.year:
                avisos.append({'id':r.id,'nome':r.nome,'data_aniversario':aniversario.isoformat(),'idade':amanha.year-nascimento.year})
        return avisos
    return backup, migrar, aniversarios_amanha
